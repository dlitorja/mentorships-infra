export const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
  "video/mpeg",
] as const;

export const ALLOWED_CONTENT_TYPE_SET: ReadonlySet<string> = new Set(
  ALLOWED_CONTENT_TYPES
);

export function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPE_SET.has(contentType);
}
