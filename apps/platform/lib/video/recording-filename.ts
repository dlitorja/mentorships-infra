/**
 * Returns a stable, human-readable filename for downloading a call
 * recording. Used as the `filename` argument to
 * `getDownloadUrlWithContentDisposition` so the file the user saves
 * has a recognizable name (e.g. `call-2026-07-08.mp4`)
 * instead of the raw Daily.co S3 key.
 *
 * PR #4c-1: keeps the filename out of personal-info by default —
 * just the date the call started, in `YYYY-MM-DD` form (UTC). If
 * `callStartedAt` is missing, invalid (NaN / Infinity), or the
 * stored S3 key lacks an extension, we fall back so the filename
 * is never empty or wrong-extension.
 *
 * CodeRabbit R5: the filename prefix avoids the project naming
 * vocabulary per AGENTS.md (no "mentor" / "mentee" derived words
 * in user-facing strings outside the "mentorships" UI exception).
 * `call-` is the shortest stable prefix that still describes the
 * file in the user's Downloads folder.
 *
 * Extension: derived from `recordingS3Key` when supplied so
 * non-MP4 recordings (`.mov`, `.webm`) save with the right file
 * extension. Falls back to `.mp4` for keys without an extension
 * (Daily.co defaults to MP4).
 *
 * Sanitization: the date format itself is already filesystem-safe
 * (digits + hyphens, ≤ 10 chars). No additional escaping needed.
 */
export function recordingDownloadFilename(
  callStartedAt: number | null | undefined,
  recordingS3Key?: string | null
): string {
  const ts =
    typeof callStartedAt === "number" && Number.isFinite(callStartedAt)
      ? callStartedAt
      : Date.now();
  const date = new Date(ts).toISOString().slice(0, 10);
  const ext = recordingExtension(recordingS3Key ?? null);
  return `call-${date}${ext}`;
}

/**
 * Returns the lowercase file extension (including the leading
 * dot) for a recording key. Defaults to `.mp4` if the key is
 * empty or has no recognised video extension. PR #4c-1 R4 P2:
 * callers used to hardcode `.mp4` which produced wrong extensions
 * for `.mov` / `.webm` Daily outputs.
 */
function recordingExtension(recordingS3Key: string | null): string {
  if (!recordingS3Key) return ".mp4";
  const lower = recordingS3Key.toLowerCase();
  if (lower.endsWith(".mov")) return ".mov";
  if (lower.endsWith(".webm")) return ".webm";
  if (lower.endsWith(".mp4")) return ".mp4";
  if (lower.endsWith(".m4v")) return ".m4v";
  if (lower.endsWith(".mkv")) return ".mkv";
  return ".mp4";
}
