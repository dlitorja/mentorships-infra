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

/** `onboarding/<onboardingId>/exports/…` (artwork ZIP). */
const ONBOARDING_EXPORT_SEGMENT = "/exports/";

/**
 * True when a B2 key belongs to a generated export artifact.
 *
 * Workspace exports live under a dedicated `exports/` prefix. Onboarding
 * exports share the `onboarding/` prefix with the uploaded artwork
 * itself, so they are identified by the `/exports/` segment — the
 * uploads sit at `onboarding/<id>/<fileId>/<name>`.
 */
export function isExportArtifactKey(key: string): boolean {
  if (key.startsWith(WORKSPACE_EXPORT_PREFIX)) return true;
  return key.startsWith("onboarding/") && key.includes(ONBOARDING_EXPORT_SEGMENT);
}

export interface ExportArtifactObject {
  key: string;
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
