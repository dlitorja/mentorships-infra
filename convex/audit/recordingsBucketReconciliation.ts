import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Weekly reconciliation between the recordings bucket and `sessions`.
 *
 * The hourly `recordingRetentionAudit` covers the DB side: rows whose
 * `recordingExpiresAt` passed but were never marked `purged`. It cannot
 * see the opposite failure — **the row says `purged` and the object is
 * still there** — because `deleteFromB2` is an idempotent S3
 * `DeleteObject`: pointing it at the wrong bucket returns success, the
 * row flips to `purged`, and the bytes survive with no error, no log and
 * no event. That is exactly what happened before `RECORDINGS_BUCKET_NAME`
 * existed (recordings were split across `instructor-uploads` and
 * `mentorship-call-storage`).
 *
 * This job is the only detector for that class. It lists `recordings/`
 * in the recordings bucket and diffs it against `sessions`:
 *
 *   object + `purged` row          → drift: retry the delete, then alert
 *   object + `ready` row, in date  → healthy
 *   object + `ready` row, expired  → report only (daily cleanup owns it)
 *   object + no row                → orphan; delete only if older than 7d
 *   object + `pending`/`uploading` → skip (in-flight transfer)
 *   `purged` row, no object        → healthy
 *
 * Deliberately NOT Event Notifications: those fire on deletes that
 * happen, and are silent for a delete that no-ops, which is the case we
 * care about. Volume here is a weekly list (Class C, free).
 *
 * One alert email per run, never per object.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RECORDINGS_PREFIX = "recordings/";
/** An object with no session row is only deleted once it is this old; younger
 * objects may belong to a transfer that wrote the object but has not yet
 * called `attachRecordingFromB2Upload`. */
export const ORPHAN_MIN_AGE_MS = 7 * DAY_MS;

export type RecordingObjectRow = {
  fileId: string;
  fileName: string;
  contentLength?: number;
  uploadTimestamp: number;
};

export type SessionRow = {
  sessionId: Id<"sessions">;
  status?: string;
  recordingUrl?: string;
  expiresAt?: number;
};

export type DriftKind =
  | "purged_but_present"
  | "orphan"
  | "expired_not_purged";

export type DriftItem = {
  kind: DriftKind;
  key: string;
  fileId: string;
  sessionId: Id<"sessions"> | null;
  bytes: number;
  /** True when this run is allowed to delete the object. */
  deletable: boolean;
  reason: string;
};

export type ReconciliationClassification = {
  drift: DriftItem[];
  healthy: number;
  skippedInFlight: number;
};

/**
 * Pure diff. Extracted so the risky part is testable without B2 or a
 * Convex runtime.
 */
export function classifyRecordingObjects(
  objects: readonly RecordingObjectRow[],
  sessions: readonly SessionRow[],
  now: number
): ReconciliationClassification {
  const bySessionId = new Map<string, SessionRow>();
  for (const session of sessions) {
    bySessionId.set(String(session.sessionId), session);
  }

  const drift: DriftItem[] = [];
  let healthy = 0;
  let skippedInFlight = 0;

  for (const object of objects) {
    const sessionId = object.fileName.split("/")[1] ?? null;
    const session = sessionId ? bySessionId.get(sessionId) : undefined;
    const bytes = object.contentLength ?? 0;
    const ageMs = now - object.uploadTimestamp;
    const base = {
      key: object.fileName,
      fileId: object.fileId,
      sessionId: (session?.sessionId ?? null) as Id<"sessions"> | null,
      bytes,
    };

    if (!session) {
      drift.push({
        ...base,
        kind: "orphan",
        deletable: ageMs > ORPHAN_MIN_AGE_MS,
        reason:
          ageMs > ORPHAN_MIN_AGE_MS
            ? "no session row holds this key (leftover from a retry or a failed attach)"
            : "no session row yet, but the object is recent — possibly an in-flight attach",
      });
      continue;
    }

    if (session.status === "purged") {
      drift.push({
        ...base,
        kind: "purged_but_present",
        deletable: true,
        reason: "session is purged but the object still exists — the purge deleted somewhere else",
      });
      continue;
    }

    if (
      session.status === "pending" ||
      session.status === "uploading" ||
      session.status === "failed"
    ) {
      // `pending`/`uploading`: the transfer writes the object before
      // `attachRecordingFromB2Upload` patches the row, so this is normal.
      // `failed`: retried manually; do not delete its bytes.
      skippedInFlight++;
      continue;
    }

    if (session.status === "ready") {
      if (session.recordingUrl === object.fileName) {
        if (session.expiresAt !== undefined && session.expiresAt <= now) {
          drift.push({
            ...base,
            kind: "expired_not_purged",
            deletable: false,
            reason: "past recordingExpiresAt but not purged — the daily cleanup owns this",
          });
        } else {
          healthy++;
        }
        continue;
      }

      // A different object is attached to this session, so this one is a
      // duplicate upload from a retry with a different recordingId.
      drift.push({
        ...base,
        kind: "orphan",
        deletable: ageMs > ORPHAN_MIN_AGE_MS,
        reason: "session is ready with a different key — duplicate upload from a retry",
      });
      continue;
    }

    // Unknown/absent status on a row that has a sessionId: do not touch it.
    skippedInFlight++;
  }

  return { drift, healthy, skippedInFlight };
}

/**
 * Look up the sessions referenced by a batch of object keys.
 *
 * Looked up **by id** rather than by scanning `sessions`: the table grows
 * with all history, so a full scan eventually exceeds Convex's per-query
 * read limits, and filtering it by `recordingUrl` silently dropped
 * `failed` / `pending` / `uploading` rows (which have no URL) — making
 * their objects look like orphans and eligible for deletion.
 *
 * `purged` rows have `recordingUrl` cleared by `markRecordingDeleted`;
 * they are returned here because they are matched by the session id
 * embedded in the key.
 */
export const getSessionsByIds = internalQuery({
  args: { ids: v.array(v.id("sessions")) },
  handler: async (ctx, args): Promise<SessionRow[]> => {
    const rows: SessionRow[] = [];
    for (const id of args.ids) {
      const session = await ctx.db.get(id);
      if (!session) continue;
      rows.push({
        sessionId: session._id,
        status: session.recordingTransferStatus,
        recordingUrl: session.recordingUrl,
        expiresAt: session.recordingExpiresAt,
      });
    }
    return rows;
  },
});

type B2Auth = {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
};

async function authorizeB2(): Promise<B2Auth> {
  const keyId = process.env.B2_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;
  if (!keyId || !applicationKey) {
    throw new Error("Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY");
  }

  const credentials = btoa(`${keyId}:${applicationKey}`);
  const response = await fetch(
    "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
    {
      method: "POST",
      // B2 rejects a truly empty body with "object should start with brace".
      body: "{}",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!response.ok) {
    throw new Error(`B2 authorize failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    accountId: string;
    authorizationToken: string;
    apiInfo?: { storageApi?: { apiUrl?: string } };
  };
  const apiUrl = data.apiInfo?.storageApi?.apiUrl;
  if (!apiUrl) {
    throw new Error("B2 authorize returned no storage apiUrl");
  }
  return {
    accountId: data.accountId,
    authorizationToken: data.authorizationToken,
    apiUrl,
  };
}

function b2Post<T>(auth: B2Auth, fn: string, body: unknown): Promise<T> {
  return fetch(`${auth.apiUrl}/b2api/v4/${fn}`, {
    method: "POST",
    headers: {
      // B2 expects the raw token, not "Bearer <token>".
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then(async (response) => {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`B2 ${fn} failed: ${response.status} ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  });
}

async function resolveBucketId(auth: B2Auth, bucketName: string): Promise<string> {
  const data = await b2Post<{ buckets: Array<{ bucketName: string; bucketId: string }> }>(
    auth,
    "b2_list_buckets",
    { accountId: auth.accountId }
  );
  const bucket = data.buckets.find((b) => b.bucketName === bucketName);
  if (!bucket) {
    throw new Error(`Recordings bucket "${bucketName}" not found in the B2 account`);
  }
  return bucket.bucketId;
}

const MAX_LIST_PAGES = 1000;
const SESSION_LOOKUP_BATCH = 500;
const CONVEX_ID_PATTERN = /^[a-z0-9]{20,40}$/;

async function listRecordingObjects(
  auth: B2Auth,
  bucketId: string
): Promise<{ objects: RecordingObjectRow[]; truncated: boolean }> {
  const out: RecordingObjectRow[] = [];
  let startFileName: string | undefined;

  // Safety bound only — 1000 pages is ~1M objects. If it is ever hit we
  // report truncation instead of silently claiming a clean scan.
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const body: Record<string, unknown> = {
      bucketId,
      prefix: RECORDINGS_PREFIX,
      maxFileCount: 1000,
    };
    if (startFileName) body.startFileName = startFileName;

    const data = await b2Post<{
      files: Array<{
        fileId: string;
        fileName: string;
        contentLength?: number;
        uploadTimestamp: number;
      }>;
      nextFileName?: string | null;
    }>(auth, "b2_list_file_names", body);

    for (const file of data.files ?? []) {
      out.push({
        fileId: file.fileId,
        fileName: file.fileName,
        contentLength: file.contentLength,
        uploadTimestamp: file.uploadTimestamp,
      });
    }

    if (!data.nextFileName) return { objects: out, truncated: false };
    startFileName = data.nextFileName;
  }

  return { objects: out, truncated: true };
}

async function deleteObject(auth: B2Auth, item: DriftItem): Promise<void> {
  const response = await fetch(`${auth.apiUrl}/b2api/v4/b2_delete_file_version`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileId: item.fileId, fileName: item.key }),
  });

  // 404 is fine: a previous run or the daily cleanup already removed it.
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`delete ${item.key} failed: ${response.status} ${text.slice(0, 160)}`);
  }
}

type AlertResult = "sent" | "skipped" | "failed";

async function sendDriftAlert(summary: {
  scanned: number;
  drift: DriftItem[];
  deleted: number;
  deleteFailures: string[];
}): Promise<AlertResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM;
  const to =
    process.env.RECORDING_RECONCILIATION_ALERT_EMAIL ??
    process.env.EMAIL_REPLY_TO ??
    process.env.EMAIL_FROM;

  if (!apiKey || !from || !to) return "skipped";

  const lines = summary.drift.map(
    (item) =>
      `${item.kind}: ${item.key} (${(item.bytes / 1024 ** 2).toFixed(1)} MB, ${item.deletable ? "deletable" : "report only"}) — ${item.reason}`
  );

  const text = [
    `Recordings bucket reconciliation found ${summary.drift.length} drift item(s) out of ${summary.scanned} object(s).`,
    `Deleted this run: ${summary.deleted}.`,
    summary.deleteFailures.length > 0
      ? `Delete failures: ${summary.deleteFailures.length}`
      : "",
    "",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[recordings] ${summary.drift.length} drift item(s) in the recordings bucket`,
        text,
      }),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export const reconcileRecordingsBucket = internalAction({
  args: {},
  handler: async (ctx) => {
    const bucketName = process.env.RECORDINGS_BUCKET_NAME?.trim();
    if (!bucketName) {
      throw new Error(
        "RECORDINGS_BUCKET_NAME is not set — cannot reconcile the recordings bucket"
      );
    }

    const auth = await authorizeB2();
    const bucketId = await resolveBucketId(auth, bucketName);
    const { objects, truncated } = await listRecordingObjects(auth, bucketId);

    // Resolve only the sessions these objects refer to, in batches. Ids are
    // validated first: `ctx.db.get` throws on a malformed id, and the key
    // segment is attacker-influenced only in the sense that it is whatever
    // was uploaded.
    const sessionIds = new Set<string>();
    for (const object of objects) {
      const candidate = object.fileName.split("/")[1] ?? "";
      if (CONVEX_ID_PATTERN.test(candidate)) sessionIds.add(candidate);
    }

    const sessions: SessionRow[] = [];
    const idList = Array.from(sessionIds);
    for (let i = 0; i < idList.length; i += SESSION_LOOKUP_BATCH) {
      const batch = idList
        .slice(i, i + SESSION_LOOKUP_BATCH)
        .map((id) => id as Id<"sessions">);
      const rows = await ctx.runQuery(
        internal.audit.recordingsBucketReconciliation.getSessionsByIds,
        { ids: batch }
      );
      sessions.push(...rows);
    }

    const now = Date.now();
    const { drift, healthy, skippedInFlight } = classifyRecordingObjects(
      objects,
      sessions,
      now
    );

    let deleted = 0;
    const deleteFailures: string[] = [];
    for (const item of drift) {
      if (!item.deletable) continue;
      try {
        await deleteObject(auth, item);
        deleted++;
      } catch (error) {
        deleteFailures.push(
          `${item.key}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const alert =
      drift.length > 0
        ? await sendDriftAlert({
            scanned: objects.length,
            drift,
            deleted,
            deleteFailures,
          })
        : "skipped";

    const summary = {
      bucket: bucketName,
      scanned: objects.length,
      truncated,
      sessionsResolved: sessions.length,
      healthy,
      skippedInFlight,
      drift: drift.length,
      purgedButPresent: drift.filter((d) => d.kind === "purged_but_present").length,
      orphans: drift.filter((d) => d.kind === "orphan").length,
      expiredNotPurged: drift.filter((d) => d.kind === "expired_not_purged").length,
      deleted,
      deleteFailures: deleteFailures.length,
      alert,
      ranAt: now,
    };

    if (truncated) {
      // Incomplete scan: never report this as clean.
      console.error(
        `[recordingsBucketReconciliation] scan truncated at ${MAX_LIST_PAGES} pages (${objects.length} objects) — later objects were NOT checked`,
        { bucket: bucketName, objects: objects.length }
      );
    }

    if (drift.length > 0) {
      // Structured log for the Axiom export, same shape as the hourly audits.
      console.error(
        `[recordingsBucketReconciliation] drift=${summary.drift} purgedButPresent=${summary.purgedButPresent} orphans=${summary.orphans} expiredNotPurged=${summary.expiredNotPurged} deleted=${deleted} failures=${deleteFailures.length}`,
        { ...summary, driftDetail: drift }
      );
    } else {
      console.log(
        `[recordingsBucketReconciliation] clean — scanned=${objects.length} healthy=${healthy} skippedInFlight=${skippedInFlight}`
      );
    }

    return summary;
  },
});
