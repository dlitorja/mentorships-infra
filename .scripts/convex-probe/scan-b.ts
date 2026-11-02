#!/usr/bin/env -S npx tsx
/* eslint-disable */
// scan-b.ts — Step 1 SCAN for convex-authz's 4-shape taxonomy.
//
// History: derived from the security-audit pilot at commit 9fbf1794
// (`/tmp/opencode/sec-pilot/scan.ts` at pilot time). The hard-coded
// `ROOT` and `/tmp/opencode/sec-pilot/` output paths have been removed
// to make this script portable across:
//   - local dev (operator runs `npx tsx scan-b.ts ./convex`),
//   - CI (GitHub Actions runs from repo root; default `./convex` works),
//   - other checkouts (different disk layout).
//
// The detection logic is unchanged from the pilot. Sizes of the
// convex-authz 4-shape taxonomy (a/b/c/d) and helpers are unchanged.

import { mkdirSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import {
  hasAuthCheck as libHasAuthCheck,
  hasIdentityComparison,
  lineAt,
  loadSuppressions,
  partitionSuppressed,
  probeDirFromArgv,
  writeSuppressedArtifact,
} from "./lib";

/**
 * scan-b treats *any* `identity.subject` mention as "has some auth" so shape
 * (b) can distinguish "authorized but no row comparison" from "no auth at all".
 */
const hasAuthCheck = (body: string) =>
  libHasAuthCheck(body, { allowBareSubjectReference: true });

// CONVEX_DIR is supplied as the first positional CLI argument; defaults
// to `./convex` for local invocation from repo root. On CI, the workflow
// sets it to `../../convex` (relative to `.scripts/convex-probe/`).
const CONVEX_DIR = process.argv[2] ?? "./convex";

if (!CONVEX_DIR) {
  console.error("usage: tsx scan-b.ts <convex-dir>");
  console.error("  default: ./convex");
  process.exit(2);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    const p = `${dir}/${ent}`;
    const s = statSync(p);
    if (s.isDirectory()) {
      if (ent === "_generated") continue;
      out.push(...walk(p));
    } else if (p.endsWith(".ts") && !p.endsWith(".d.ts") && !p.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(CONVEX_DIR);

type Fn = {
  name: string;
  startLine: number;
  headerLine: number;
  body: string;
  bodyStart: number;
  bodyEnd: number;
  file: string;
  type: "query" | "mutation" | "action" | "internalQuery" | "internalMutation" | "internalAction";
  isPublic: boolean;
  args: string;
};

function matchPublicFunction(src: string): Fn[] {
  const funcs: Fn[] = [];
  const re = /export const (\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const kind = m[2];
    const isPublic = !kind.startsWith("internal") && kind !== "action";
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "{") continue;
    const openBrace = i;
    let depth = 0;
    let j = openBrace;
    while (j < src.length) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        j++;
        while (j < src.length && src[j] !== ch) {
          if (src[j] === "\\") j++;
          j++;
        }
      } else if (ch === "/" && src[j + 1] === "/") {
        while (j < src.length && src[j] !== "\n") j++;
      } else if (ch === "/" && src[j + 1] === "*") {
        j += 2;
        while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
        j++;
      }
      j++;
    }
    funcs.push({
      name,
      startLine: src.slice(0, m.index).split("\n").length,
      headerLine: src.slice(0, m.index + m[0].length).split("\n").length,
      body: src.slice(openBrace, j + 1),
      bodyStart: openBrace,
      bodyEnd: j + 1,
      file: "",
      type: kind as Fn["type"],
      isPublic,
      args: "",
    });
  }
  return funcs;
}

const findings: { file: string; line: number; shape: string; name: string; msg: string }[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const funcs = matchPublicFunction(src);
  for (const fn of funcs) {
    fn.file = relative(CONVEX_DIR, file);
    fn.args = fn.body.match(/args\s*:\s*\{([\s\S]*?)\}/)?.[0] ?? "";

    if (!fn.isPublic) continue;

    // ---- Shape (a): v.id(<table>) identity arg AND zero ctx.auth ----
    const idArgRe = /\b(userId|actorId|ownerId|authorId|accountId)\s*:\s*v\.id\(/g;
    const idArgs: string[] = [];
    let ma;
    while ((ma = idArgRe.exec(fn.body)) !== null) idArgs.push(ma[1]);
    if (idArgs.length > 0 && !hasAuthCheck(fn.body)) {
      // No auth at all.
      findings.push({
        file: fn.file,
        line: fn.startLine,
        shape: "a",
        name: fn.name,
        msg: `args has v.id() identity-named field(s): ${idArgs.join(", ")}; block has no identity/role check at all.`,
      });
    }

    // ---- Shape (b): ctx.db.get(args.X) then patch/delete/replace/return without identity comparison ----
    const getArgIdRe = /ctx\.db\.get\(args\.(\w+)\)/g;
    let mb;
    while ((mb = getArgIdRe.exec(fn.body)) !== null) {
      const idName = mb[1];
      const afterGet = fn.body.slice(mb.index);
      const hasPatch = /\bctx\.db\.patch\b|\bctx\.db\.delete\b|\bctx\.db\.replace\b/.test(afterGet);
      const hasReturn = /\breturn\b/.test(afterGet);
      // Only flag if function has SOME auth, but DOESN'T compare the loaded doc against identity.
      const hasIdCmp = hasIdentityComparison(fn.body);
      // If no auth at all, it's not a "without an identity comparison" defect, it's a "with no identity" defect.
      const hasAnyAuth = hasAuthCheck(fn.body);
      if ((hasPatch || hasReturn) && hasAnyAuth && !hasIdCmp) {
        findings.push({
          file: fn.file,
          line: lineAt(src, fn.bodyStart + mb.index),
          shape: "b",
          name: fn.name,
          msg: `loads doc via ctx.db.get(args.${idName}) then patches/deletes/returns without comparing identity.subject against the loaded row's owner field`,
        });
      }
    }

    // ---- Shape (c): PII-leaking public query ----
    if (fn.type === "query") {
      const stripped = fn.body
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const piiFields = ["email", "googleRefreshToken", "revenue", "ssn", "password", "token", "auditLog"];
      for (const field of piiFields) {
        // Look for the field inside the `returns:` block only.
        const returnsBlockMatch = fn.body.match(/returns\s*:\s*[a-zA-Z<>]+\s*[=:]\s*([\s\S]*?)(?:,\s*handler\s*:|^\s*}\s*[,;])/m);
        // Simpler: just look at the whole body — if `returns:` declaration exists AND the field is mentioned
        // (not in a comment) AND no ctx.auth, flag.
        const fieldStripped = stripped.match(new RegExp(`\\b${field}\\b`));
        if (fieldStripped && !hasAuthCheck(fn.body) && /\breturns\s*:/.test(fn.body)) {
          findings.push({
            file: fn.file,
            line: fn.startLine,
            shape: "c",
            name: fn.name,
            msg: `public query mentions PII field "${field}" and has no auth check — candidate PII leak`,
          });
          break;
        }
      }
    }

    // ---- Shape (d): parent FK on write without parent ownership verify ----
    const insertPatchRe = /\bctx\.db\.(insert|patch|replace)\b/g;
    let mi;
    while ((mi = insertPatchRe.exec(fn.body)) !== null) {
      const window = fn.body.slice(Math.max(0, mi.index - 1500), mi.index);
      const argsInWindow = Array.from(window.matchAll(/args\.([a-zA-Z]+)/g)).map((mm) => mm[1]);
      const parentNames = ["projectId", "boardId", "teamId", "orgId", "listId", "folderId", "conversationId", "accountId", "instructorId", "workspaceId", "sessionPackId", "seatReservationId", "parentId", "orderId", "paymentId", "exportId"];
      const parentArgs = argsInWindow.filter((n) => parentNames.includes(n));
      if (parentArgs.length === 0) continue;
      if (!hasAuthCheck(fn.body)) continue;
      const argName = parentArgs[parentArgs.length - 1];
      const helpers = [
        `ctx\\.db\\.get\\(args\\.${argName}\\)`,
        `requireOwner\\([^)]*${argName}`,
        `assertParticipant\\([^)]*${argName}`,
        `assertParticipantForSession\\([^)]*${argName}`,
        `assertWorkspaceParticipant\\([^)]*${argName}`,
        `isInstructorForWorkspace\\([^)]*${argName}`,
        `assertSessionBelongsToWorkspace\\([^)]*${argName}`,
        `getWorkspaceIfActive\\([^)]*${argName}`,
        `getWorkspaceIfNotDeleted\\([^)]*${argName}`,
        `getWorkspaceRole\\([^)]*${argName}`,
        `requireCallerWorkspaceRole\\([^)]*${argName}`,
        `assertResourceBelongsToInstructor\\([^)]*${argName}`,
        `assertCanModifySessionPack\\([^)]*${argName}`,
        `assertB2FileUploadOwnedByCaller\\([^)]*${argName}`,
        "isParticipant"
      ];
      const reParentCheck = helpers.some((h) => new RegExp(h).test(window));
      if (!reParentCheck) {
        // Check the whole body once for `args.<argName>` followed anywhere by `get` — broader scan.
        const reBodyCheckNew = new RegExp([
        `ctx\\.db\\.get\\(args\\.${argName}\\)`,
        `await\\s+ctx\\.db\\.get\\(args\\.${argName}\\)`,
        `requireOwner\\([^)]*${argName}`,
        `assertParticipantForSession\\([^)]*${argName}`,
        `assertWorkspaceParticipant\\([^)]*${argName}`,
        `isInstructorForWorkspace\\([^)]*${argName}`,
        `assertSessionBelongsToWorkspace\\([^)]*${argName}`,
        `getWorkspaceIfActive\\([^)]*${argName}`,
        `getWorkspaceIfNotDeleted\\([^)]*${argName}`,
        `getWorkspaceRole\\([^)]*${argName}`,
        `requireCallerWorkspaceRole\\([^)]*${argName}`,
        `assertResourceBelongsToInstructor\\([^)]*${argName}`,
        `assertCanModifySessionPack\\([^)]*${argName}`,
        `assertB2FileUploadOwnedByCaller\\([^)]*${argName}`,
        "isParticipant"
      ].join("|")).test(fn.body);
        if (!reBodyCheckNew) {
          findings.push({
            file: fn.file,
            line: lineAt(src, fn.bodyStart + mi.index),
            shape: "d",
            name: fn.name,
            msg: `args.${argName} is used as parent FK in ${mi[1]} without ctx.db.get(args.${argName}) / requireOwner check before the write`,
          });
        }
      }
    }
  }
}

// Shape (b) reports once per `ctx.db.get(args.X)` occurrence, so the same
// function can appear several times. Collapse per (file, function, shape).
const seen = new Set<string>();
const deduped = findings.filter((f) => {
  const key = `${f.file}::${f.shape}::${f.name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const probeDir = probeDirFromArgv();
const { active, expired, invalid } = loadSuppressions(probeDir);
for (const bad of invalid) console.warn(`[scan-b] ignoring invalid suppression: ${bad}`);
for (const old of expired) {
  console.warn(`[scan-b] suppression expired, hit resurfaced: ${old.file}::${old.function}`);
}
const { kept, suppressed } = partitionSuppressed(deduped, active, "scan-b");

// Group by file
const out = kept.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

// Write findings to ./artifacts/ — relative to wherever the script is invoked
// from. CI uploads these via actions/upload-artifact@v4.
mkdirSync("./artifacts", { recursive: true });
writeFileSync("./artifacts/findings-raw.json", JSON.stringify(out, null, 2));
// An empty finding set writes an empty file (not "\n"), so the file's line
// count equals the finding count.
writeFileSync(
  "./artifacts/findings-raw.txt",
  out.length === 0
    ? ""
    : out.map((f) => `${f.file.padEnd(50)} :${String(f.line).padEnd(5)} [${f.shape}] ${f.name.padEnd(35)} ${f.msg}`).join("\n") + "\n"
);
writeSuppressedArtifact("./artifacts/findings-suppressed-scan-b.json", suppressed);
console.log(`Total hits: ${out.length}`);
if (suppressed.length > 0) console.log(`Suppressed (accepted): ${suppressed.length}`);
if (findings.length !== deduped.length) {
  console.log(`Deduped: ${findings.length - deduped.length}`);
}
console.log(`By shape: a=${out.filter((f) => f.shape === "a").length} b=${out.filter((f) => f.shape === "b").length} c=${out.filter((f) => f.shape === "c").length} d=${out.filter((f) => f.shape === "d").length}`);
