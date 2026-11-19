/**
 * Convex database backup keys + retention selection.
 *
 * Managed Convex on the Starter plan has no dashboard backups, so the
 * only durable copy of row data (chat text, notes, links, aliases —
 * everything that is not already in B2) is the export this job
 * writes. The export contains documents only; file bytes stay in B2.
 *
 * Layout:
 *   convex-backups/<deployment>/<YYYY>/<MM>/<DD>/<timestamp>.zip
 *   convex-backups/<deployment>/<YYYY>/<MM>/<DD>/<timestamp>.manifest.json
 *
 * Keys are immutable (timestamped, never overwritten), which keeps the
 * retention sweep simple and means a half-written day cannot destroy
 * the previous backup.
 */

export const CONVEX_BACKUP_PREFIX = "convex-backups";
export const CONVEX_BACKUP_RETENTION_DAYS = 90;
/** Always keep at least this many of the newest backups per deployment. */
export const CONVEX_BACKUP_MIN_KEEP = 7;

export interface ConvexBackupKey {
  deployment: string;
  timestamp: number;
  zipKey: string;
  manifestKey: string;
}

export interface ParsedConvexBackupKey {
  deployment: string;
  timestamp: number;
  isManifest: boolean;
  fileName: string;
}

export function convexBackupPrefix(deployment: string): string {
  return `${CONVEX_BACKUP_PREFIX}/${deployment}/`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `20261119T020000000Z` — sortable and safe in an object key. */
export function formatBackupTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}` +
    `${pad(date.getUTCMilliseconds(), 3)}Z`
  );
}

export function buildConvexBackupKey(
  deployment: string,
  timestamp: number
): ConvexBackupKey {
  const date = new Date(timestamp);
  const folder =
    `${convexBackupPrefix(deployment)}` +
    `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/` +
    `${pad(date.getUTCDate())}`;
  const base = `${folder}/${formatBackupTimestamp(timestamp)}`;
  return {
    deployment,
    timestamp,
    zipKey: `${base}.zip`,
    manifestKey: `${base}.manifest.json`,
  };
}

const BACKUP_KEY_RE =
  /^convex-backups\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{8}T\d{9}Z)\.(zip|manifest\.json)$/;

export function parseConvexBackupKey(
  key: string
): ParsedConvexBackupKey | null {
  const match = BACKUP_KEY_RE.exec(key);
  if (!match) return null;

  const [, deployment, year, month, day, stamp, extension] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(stamp.slice(9, 11)),
    Number(stamp.slice(11, 13)),
    Number(stamp.slice(13, 15)),
    Number(stamp.slice(15, 18))
  );
  if (!Number.isFinite(timestamp)) return null;

  return {
    deployment,
    timestamp,
    isManifest: extension === "manifest.json",
    fileName: `${stamp}.${extension}`,
  };
}

export interface ConvexBackupVersion {
  key: string;
  /** S3/B2 version id; `"null"` when the bucket was not versioned. */
  versionId: string;
  /** Last-modified time in epoch milliseconds. */
  lastModified: number;
}

/**
 * Versions that can be deleted under the retention policy.
 *
 * Operates on object *versions* (not keys) because B2 buckets are
 * versioned by default: deleting a key without a `VersionId` only adds
 * a hide marker and the bytes keep billing. Pure so the selection can
 * be unit-tested without B2; `now` is injected.
 */
export function selectExpiredConvexBackupVersions(
  versions: readonly ConvexBackupVersion[],
  now: number,
  options: {
    retentionDays?: number;
    minKeep?: number;
  } = {}
): Array<{ key: string; versionId: string }> {
  const retentionDays = options.retentionDays ?? CONVEX_BACKUP_RETENTION_DAYS;
  const minKeep = options.minKeep ?? CONVEX_BACKUP_MIN_KEEP;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  const parsed = versions
    .map((version) => ({
      version,
      parsed: parseConvexBackupKey(version.key),
    }))
    .filter(
      (
        entry
      ): entry is { version: ConvexBackupVersion; parsed: ParsedConvexBackupKey } =>
        entry.parsed !== null
    );

  // Keep the newest `minKeep` distinct backup timestamps per
  // deployment even when they are past the retention cutoff, so a job
  // outage never ages out every copy.
  const timestampsByDeployment = new Map<string, number[]>();
  for (const { parsed: key } of parsed) {
    const list = timestampsByDeployment.get(key.deployment) ?? [];
    list.push(key.timestamp);
    timestampsByDeployment.set(key.deployment, list);
  }
  const keepTimestamps = new Set<string>();
  for (const [deployment, timestamps] of timestampsByDeployment) {
    const newest = [...new Set(timestamps)]
      .sort((a, b) => b - a)
      .slice(0, minKeep);
    for (const timestamp of newest) {
      keepTimestamps.add(`${deployment}:${timestamp}`);
    }
  }

  return parsed
    .filter(({ parsed: key, version }) => {
      if (key.timestamp >= cutoff) return false;
      if (keepTimestamps.has(`${key.deployment}:${key.timestamp}`)) return false;
      // Deleting a version removes the bytes. A hide marker would
      // leave the archived copy billed forever.
      return version.versionId.length > 0;
    })
    .map(({ version }) => ({
      key: version.key,
      versionId: version.versionId,
    }));
}
