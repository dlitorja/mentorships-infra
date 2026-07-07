/**
 * Returns a stable, human-readable filename for downloading a call
 * recording. Used as the `filename` argument to
 * `getDownloadUrlWithContentDisposition` so the file the user saves
 * has a recognizable name (e.g. `mentorship-call-2026-07-08.mp4`)
 * instead of the raw Daily.co S3 key.
 *
 * PR #4c-1: keeps the filename out of personal-info by default —
 * just the date the call started, in `YYYY-MM-DD` form (UTC). If
 * `callStartedAt` is missing (recordings for sessions that never
 * reached `callStartedAt`), falls back to today's date so the
 * filename is never empty.
 *
 * Sanitization: the date format itself is already filesystem-safe
 * (digits + hyphens, ≤ 10 chars). No additional escaping needed.
 */
export function recordingDownloadFilename(
  callStartedAt: number | null | undefined
): string {
  const ts = typeof callStartedAt === "number" ? callStartedAt : Date.now();
  const date = new Date(ts).toISOString().slice(0, 10);
  return `mentorship-call-${date}.mp4`;
}
