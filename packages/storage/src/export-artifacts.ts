/**
 * Export artifact lifetime + sweep helpers.
 *
 * Generated export files (workspace ZIP/CSV, onboarding artwork ZIP)
 * are disposable: download links are short-lived and the reviewer can
 * rebuild in seconds. Keeping them forever wastes B2 storage, so a
 * scheduled job deletes them after this window.
 *
 * The signed download URL uses the same window (see
 * `src/trigger/workspace-export.ts`), so the UI stops offering a link
 * at roughly the moment the object becomes eligible for deletion.
 */
export const EXPORT_ARTIFACT_TTL_HOURS = 72;
export const EXPORT_ARTIFACT_TTL_MS = EXPORT_ARTIFACT_TTL_HOURS * 60 * 60 * 1000;

/** `exports/<workspaceId>/…` (workspace ZIP/CSV). */
const WORKSPACE_EXPORT_PREFIX = "exports/";

/**
 * `onboarding-exports/<onboardingId>/…` (artwork ZIP).
 *
 * Deliberately a top-level prefix rather than `onboarding/<id>/exports/`:
 * upload keys embed a student-supplied `fileId`
 * (`onboarding/<id>/<fileId>/<name>`), so a student could name a source
 * artwork file `exports/...` and have the sweep delete their uploads.
 * Keeping generated archives in their own namespace makes the sweeper
 * structurally unable to touch uploaded artwork.
 */
const ONBOARDING_EXPORT_PREFIX = "onboarding-exports/";

/**
 * True when a B2 key belongs to a generated export artifact.
 *
 * Only the two dedicated namespaces match. Nothing under `onboarding/`
 * (uploaded artwork) is ever an export artifact.
 */
export function isExportArtifactKey(key: string): boolean {
  return (
    key.startsWith(WORKSPACE_EXPORT_PREFIX) ||
    key.startsWith(ONBOARDING_EXPORT_PREFIX)
  );
}

export interface ExportArtifactObject {
  key: string;
  /** Last-modified time in epoch milliseconds. */
  lastModified: number;
}

/**
 * One stored version of an export artifact.
 *
 * Backblaze B2 buckets default to versioning, so `DeleteObject` without
 * a `VersionId` only adds a delete marker — the bytes stay billed. The
 * sweep lists versions and deletes every one of an expired key.
 */
export interface ExportArtifactVersion {
  key: string;
  /** B2/S3 version id; `"null"` for an object written while versioning was off. */
  versionId: string;
  /** Last-modified time in epoch milliseconds. */
  lastModified: number;
}

/**
 * Keys that are export artifacts older than `ttlMs`.
 *
 * Pure so the sweep can be unit-tested without B2. `now` is injected
 * for the same reason.
 */
export function selectExpiredExportArtifacts(
  objects: readonly ExportArtifactObject[],
  now: number,
  ttlMs: number = EXPORT_ARTIFACT_TTL_MS
): string[] {
  const cutoff = now - ttlMs;
  return objects
    .filter(
      (object) =>
        isExportArtifactKey(object.key) && object.lastModified < cutoff
    )
    .map((object) => object.key);
}

/**
 * Every version to delete for export artifacts whose newest version is
 * older than `ttlMs`.
 *
 * A key is expired only when *all* of its versions are old (the newest
 * one is the current bytes). Once expired, every version of that key is
 * returned so the delete reclaims storage instead of leaving hidden
 * versions behind.
 */
export function selectExpiredExportArtifactVersions(
  versions: readonly ExportArtifactVersion[],
  now: number,
  ttlMs: number = EXPORT_ARTIFACT_TTL_MS
): Array<{ key: string; versionId: string }> {
  const cutoff = now - ttlMs;
  const latestByKey = new Map<string, number>();

  for (const version of versions) {
    if (!isExportArtifactKey(version.key)) continue;
    const latest = latestByKey.get(version.key);
    if (latest === undefined || version.lastModified > latest) {
      latestByKey.set(version.key, version.lastModified);
    }
  }

  return versions
    .filter((version) => {
      if (!isExportArtifactKey(version.key)) return false;
      const latest = latestByKey.get(version.key);
      return latest !== undefined && latest < cutoff;
    })
    .map((version) => ({ key: version.key, versionId: version.versionId }));
}
