#!/usr/bin/env node
/**
 * Restore workspace images and file attachments from the B2 upload
 * ledger after the 2026-11-14..19 retention wipe.
 *
 * Why this works: `deleteAllWorkspaceContent` hard-deleted
 * `workspaceImages` and `workspaceMessages`, but never touched
 * `fileUploads` — the ledger that binds every B2 object to a
 * workspace, uploader, content type, and timestamp. Each completed
 * ledger row is enough to recreate:
 *
 *   - a `workspaceImages` row (gallery), for image uploads
 *   - a `workspaceMessages` row (`type: "image"` or `"file"`)
 *
 * Rows are imported with `npx convex import` (not a mutation) so the
 * original `_creationTime` is preserved and restored history lands in
 * the right place in the gallery / chat thread. Image counters are
 * repaired afterwards with
 * `repairs/workspaceContentRestore:recomputeWorkspaceImageCounts`.
 *
 * Text messages have no secondary store. This script cannot recover
 * them; use a Convex backup or contact Convex support about the
 * deployment's document log.
 *
 * Safety: private instructor resources use the same upload ledger and
 * key shape as chat/gallery uploads, and the ledger does not record
 * whether a resource was shared. Any key still referenced by a live
 * `instructorResources` row is skipped entirely, so the recovery
 * cannot expose a resource the instructor never shared. The residual
 * case is a resource that was uploaded *and hard-deleted* before the
 * wipe: it has a completed ledger row and no surviving row to match
 * against. Review the dry-run list before `--apply` on a workspace
 * whose instructor deletes resources frequently.
 *
 * Usage (dry run is the default):
 *   node scripts/restore-workspace-content.mjs --all
 *   node scripts/restore-workspace-content.mjs --workspace m97...
 *   node scripts/restore-workspace-content.mjs --workspace m97... --apply
 *
 * Preconditions for `--apply`:
 *   - CONVEX_DEPLOY_KEY in the environment points at the target
 *     deployment (the repo's `.env.local` is loaded by `npx convex`).
 *   - The routine code that adds
 *     `repairs/workspaceContentRestore:recomputeWorkspaceImageCounts`
 *     has been deployed to that deployment.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}
function value(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const apply = flag("apply");
const workspaceFilter = value("workspace");
const allWorkspaces = flag("all");

if (apply && !workspaceFilter && !allWorkspaces) {
  console.error(
    "Refusing to --apply without an explicit --workspace <id> or --all."
  );
  process.exit(1);
}

function convex(argsList) {
  try {
    return execFileSync("npx", ["convex", ...argsList], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 256,
    });
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? "";
    throw new Error(
      `npx convex ${argsList.join(" ")} failed:\n${stderr.slice(0, 2000)}`
    );
  }
}

// `npx convex data` caps a single read at 10,000 rows. Refuse to
// apply from a truncated read: a partial `fileUploads` view would
// miss rows, and a partial `workspaceMessages` view would fail to
// suppress duplicates and append the same content twice.
const READ_LIMIT = 10000;

function loadTable(table) {
  const output = convex([
    "data",
    table,
    "--format",
    "jsonLines",
    "--limit",
    String(READ_LIMIT),
  ]);
  const rows = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (rows.length >= READ_LIMIT) {
    throw new Error(
      `${table} returned ${rows.length} rows (limit ${READ_LIMIT}); ` +
        "read is truncated. Refusing to apply from partial data."
    );
  }
  return rows;
}

function b2KeyFromMessage(message) {
  if (typeof message.b2Key === "string" && message.b2Key.length > 0) {
    return message.b2Key;
  }
  if (
    (message.type === "image" || message.type === "file") &&
    typeof message.content === "string"
  ) {
    const separator = message.content.indexOf("|");
    const candidate =
      separator >= 0 ? message.content.slice(separator + 1) : message.content;
    if (candidate && !candidate.startsWith("http")) return candidate;
  }
  return undefined;
}

function fileNameFromKey(key) {
  const segment = key.split("/").pop() ?? "file";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function senderRoleFor(upload, workspace, instructorUserId) {
  if (upload.uploaderId === workspace.ownerId) return "student";
  if (instructorUserId !== undefined && upload.uploaderId === instructorUserId) {
    return "instructor";
  }
  return "admin";
}

/**
 * Convex preserves `_creationTime` on import. Sub-millisecond stagger
 * keeps related rows (gallery image + chat image) in the original
 * insert order without changing their visible date.
 */
function withOffset(base, offset) {
  return base + offset;
}

console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);

const uploads = loadTable("fileUploads");
const workspaces = new Map(loadTable("workspaces").map((w) => [w._id, w]));
const instructors = new Map(
  loadTable("instructors").map((instructor) => [instructor._id, instructor])
);
const existingMessages = loadTable("workspaceMessages");
const existingImages = loadTable("workspaceImages");
const instructorResources = loadTable("instructorResources");

const existingMessageKeys = new Set(
  existingMessages.map(b2KeyFromMessage).filter(Boolean)
);
const existingImageKeys = new Set(
  existingImages.map((image) => image.b2Key).filter(Boolean)
);

// Private instructor resources share the same upload ledger and B2 key
// shape as chat/gallery uploads. A resource is only student-visible
// after `shareResourceToChat`; the ledger does not record that step.
// Never turn a surviving resource into a chat row or gallery image —
// that would disclose a private file to every workspace participant.
const resourceKeys = new Set(
  instructorResources.map((resource) => resource.b2Key).filter(Boolean)
);

const targetWorkspaceIds = workspaceFilter
  ? new Set([workspaceFilter])
  : allWorkspaces
    ? new Set(uploads.map((upload) => upload.workspaceId))
    : new Set();

if (targetWorkspaceIds.size === 0) {
  console.error("Pass --workspace <id> or --all.");
  process.exit(1);
}

const messageRows = [];
const imageRows = [];
const perWorkspace = new Map();

for (const upload of uploads) {
  if (!targetWorkspaceIds.has(upload.workspaceId)) continue;
  if (!upload.b2Key) continue;
  if (upload.completedAt === undefined) continue;
  if (upload.cancelledAt !== undefined) continue;
  if (upload.trashedAt !== undefined) continue;
  if (upload.retentionDeletedAt !== undefined) continue;

  const workspace = workspaces.get(upload.workspaceId);
  if (!workspace) continue;

  const instructor = workspace.instructorId
    ? instructors.get(workspace.instructorId)
    : undefined;
  const instructorUserId = instructor?.userId;
  const role = senderRoleFor(upload, workspace, instructorUserId);
  const isImage = (upload.contentType ?? "").toLowerCase().startsWith("image/");

  const stats = perWorkspace.get(upload.workspaceId) ?? {
    name: workspace.name,
    images: 0,
    files: 0,
    skippedExisting: 0,
    skippedResource: 0,
  };

  if (resourceKeys.has(upload.b2Key)) {
    stats.skippedResource += 1;
    perWorkspace.set(upload.workspaceId, stats);
    continue;
  }

  if (!existingMessageKeys.has(upload.b2Key)) {
    messageRows.push({
      workspaceId: upload.workspaceId,
      userId: upload.uploaderId,
      content: isImage
        ? upload.b2Key
        : `${encodeURIComponent(fileNameFromKey(upload.b2Key))}|${upload.b2Key}`,
      type: isImage ? "image" : "file",
      senderRole: role,
      b2Key: upload.b2Key,
      _creationTime: withOffset(upload.uploadedAt, isImage ? 0.0001 : 0.0002),
    });
    if (isImage) stats.images += 1;
    else stats.files += 1;
  } else {
    stats.skippedExisting += 1;
  }

  if (isImage && !existingImageKeys.has(upload.b2Key)) {
    imageRows.push({
      workspaceId: upload.workspaceId,
      imageUrl: "",
      b2Key: upload.b2Key,
      createdBy: upload.uploaderId,
      _creationTime: withOffset(upload.uploadedAt, 0),
    });
  }

  perWorkspace.set(upload.workspaceId, stats);
}

console.log(`\nWorkspaces: ${perWorkspace.size}`);
for (const [workspaceId, stats] of perWorkspace) {
  console.log(
    `  ${workspaceId}  ${stats.name}\n` +
      `    chat: ${stats.images} image, ${stats.files} file ` +
      `(skipped ${stats.skippedExisting} already present, ` +
      `${stats.skippedResource} private resource(s))`
  );
}
console.log(
  `\nRows to append: ${messageRows.length} workspaceMessages, ${imageRows.length} workspaceImages`
);

if (!apply) {
  console.log("\nDry run complete. Re-run with --apply to write.");
  process.exit(0);
}

// Counter repair must run even when every row is already present: a
// previous run can import both tables and then die before the counter
// calls, and a retry would otherwise exit as a no-op.
const workspacesNeedingCounterRepair = [...targetWorkspaceIds].filter(
  (workspaceId) => workspaces.has(workspaceId)
);

if (messageRows.length === 0 && imageRows.length === 0) {
  console.log("No rows to import; repairing counters only.");
}

const dir = mkdtempSync(join(tmpdir(), "workspace-content-restore-"));
const messagesPath = join(dir, "workspaceMessages.jsonl");
const imagesPath = join(dir, "workspaceImages.jsonl");

writeFileSync(
  messagesPath,
  messageRows.map((row) => JSON.stringify(row)).join("\n") + "\n"
);
writeFileSync(
  imagesPath,
  imageRows.map((row) => JSON.stringify(row)).join("\n") + "\n"
);

if (imageRows.length > 0) {
  convex([
    "import",
    "--table",
    "workspaceImages",
    "--append",
    "-y",
    imagesPath,
  ]);
  console.log(`Imported ${imageRows.length} workspaceImages`);
}

if (messageRows.length > 0) {
  convex([
    "import",
    "--table",
    "workspaceMessages",
    "--append",
    "-y",
    messagesPath,
  ]);
  console.log(`Imported ${messageRows.length} workspaceMessages`);
}

for (const workspaceId of workspacesNeedingCounterRepair) {
  const result = convex([
    "run",
    "repairs/workspaceContentRestore:recomputeWorkspaceImageCounts",
    JSON.stringify({ workspaceId }),
  ]);
  console.log(`Counters ${workspaceId}: ${result.trim()}`);
}

console.log("\nRestore complete.");
