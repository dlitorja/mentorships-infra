export const DISCORD_URL_REGEX = /^https:\/\/(?:discord\.gg|discord(?:app)?\.com)\/.+$/;

/**
 * Returns true when the URL is empty or matches our allowed HTTPS Discord patterns.
 */
export function isValidDiscordUrl(url: string | undefined | null): boolean {
  const trimmed = (url || "").trim();
  if (trimmed.length === 0) return true;
  return DISCORD_URL_REGEX.test(trimmed);
}
