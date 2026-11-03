/**
 * Pure diff between the recordings bucket contents and `sessions`.
 *
 * Extracted from the (removed) Convex action so the risky part is
 * testable without B2, Convex or Trigger. The caller supplies the object
 * list and the session rows; this module only classifies.
 *
 * Why this job exists: the hourly `recordingRetentionAudit` covers rows
 * past `recordingExpiresAt` that were never purged. It cannot see the
 * opposite failure — **the row says `purged` and the object is still
 * there** — because `DeleteObject` is idempotent. Aimed at the wrong
 * bucket it returns success, the row flips, and the bytes survive with no
 * error, log or event. That is what the pre-`RECORDINGS_BUCKET_NAME`
 * split produced.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An object with no session row is only deleted once it is this old.
 * The transfer writes the object *before* `attachRecordingFromB2Upload`
 * patches the row, so a young unmatched object may be a live transfer.
 */
export const ORPHAN_MIN_AGE_MS = 7 * DAY_MS;

export type RecordingObject = {
  key: string;
  size: number;
  lastModified: number;
};

export type ReconSessionRow = {
  sessionId: string;
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
  sessionId: string | null;
  bytes: number;
  /** True when this run is allowed to delete the object. */
  deletable: boolean;
  reason: string;
};

export type Classification = {
  drift: DriftItem[];
  healthy: number;
  skippedInFlight: number;
};

export function classifyRecordingObjects(
  objects: readonly RecordingObject[],
  sessions: readonly ReconSessionRow[],
  now: number
): Classification {
  const bySessionId = new Map<string, ReconSessionRow>();
  for (const session of sessions) bySessionId.set(session.sessionId, session);

  const drift: DriftItem[] = [];
  let healthy = 0;
  let skippedInFlight = 0;

  for (const object of objects) {
    const sessionId = object.key.split("/")[1] ?? null;
    const session = sessionId ? bySessionId.get(sessionId) : undefined;
    const base = {
      key: object.key,
      sessionId,
      bytes: object.size,
    };
    const ageMs = now - object.lastModified;

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
        reason:
          "session is purged but the object still exists — the purge deleted somewhere else",
      });
      continue;
    }

    if (
      session.status === "pending" ||
      session.status === "uploading" ||
      session.status === "failed"
    ) {
      // `pending`/`uploading`: the object is written before the row is
      // patched, so this is a normal in-flight state. `failed`: the bytes
      // are the only surviving copy of a recording that may still be
      // retried — never delete them.
      skippedInFlight++;
      continue;
    }

    if (session.status === "ready") {
      if (session.recordingUrl === object.key) {
        if (session.expiresAt !== undefined && session.expiresAt <= now) {
          drift.push({
            ...base,
            kind: "expired_not_purged",
            deletable: false,
            reason:
              "past recordingExpiresAt but not purged — the daily cleanup owns this",
          });
        } else {
          healthy++;
        }
        continue;
      }

      drift.push({
        ...base,
        kind: "orphan",
        deletable: ageMs > ORPHAN_MIN_AGE_MS,
        reason:
          "session is ready with a different key — duplicate upload from a retry",
      });
      continue;
    }

    // Unknown status on a row that exists: do not touch it.
    skippedInFlight++;
  }

  return { drift, healthy, skippedInFlight };
}
