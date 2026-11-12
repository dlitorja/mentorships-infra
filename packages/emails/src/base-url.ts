/**
 * Single source of truth for the public base URL that every email link is
 * built from.
 *
 * Why this exists: `NEXT_PUBLIC_URL` reaches email code through two very
 * different pipelines — the Vercel app at runtime and the Trigger.dev
 * tasks, where the value is written by `syncEnvVars` at deploy time. The
 * Trigger.dev copy was poisoned by a local deploy from this repo's
 * redacted `.env.local` (`NEXT_PUBLIC_URL="[SENSITIVE]"`), and because
 * `getBaseUrl()` returned any truthy string verbatim, every email the
 * tasks sent contained `[SENSITIVE]/auth-redirect?redirect_url=…` — a
 * relative URL that no mail client can render as a clickable link.
 *
 * The fix is to validate the value once, in one place, and fail loudly
 * instead of shipping a dead link. `trigger.config.ts` uses
 * `normalizeBaseUrl` to refuse to sync a malformed value, and
 * `getBaseUrl()` uses `requireBaseUrl` to throw with an actionable
 * message if one ever reaches a running task.
 */

/**
 * Values that are present but mean "not configured": the redacted
 * placeholder this repo's `.env.local` template uses, plus the usual
 * hand-written sentinels. Compared case-insensitively.
 */
const PLACEHOLDER_BASE_URLS = new Set([
  "[sensitive]",
  "[redacted]",
  "placeholder",
  "changeme",
  "change-me",
]);

function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  const text = String(value).trim();
  if (text.length === 0) return "an empty string";
  const truncated = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return `"${truncated}"`;
}

/**
 * Validates and normalizes a configured base URL.
 *
 * Accepted: absolute `http(s)` origins, optionally with a path prefix.
 * Trailing slashes are stripped so callers can safely concatenate
 * `/auth-redirect?…` without producing `//`.
 *
 * Rejected (returns `null`): missing/empty values, redacted placeholders,
 * bare hosts without a scheme, non-http(s) schemes, URLs with no host,
 * and URLs carrying a query, fragment, or credentials (a deployment
 * origin never legitimately has those, and silently dropping them would
 * hide a typo).
 *
 * @param raw - The candidate value, typically `process.env.NEXT_PUBLIC_URL`
 * @returns The normalized base URL, or `null` when the value is unusable
 */
export function normalizeBaseUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (PLACEHOLDER_BASE_URLS.has(trimmed.toLowerCase())) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.username || parsed.password) return null;

  const path = parsed.pathname.replace(/\/+$/, "");
  return path ? `${parsed.origin}${path}` : parsed.origin;
}

/**
 * Like `normalizeBaseUrl`, but throws with an actionable message when the
 * value cannot be used.
 *
 * Callers use this where a bad base URL must not degrade silently: an
 * email whose link cannot be clicked is worse than no email, because the
 * recipient believes they were notified.
 *
 * @param raw - The candidate value
 * @param source - Env var name, used in the error message
 * @returns The normalized base URL
 * @throws Error when the value is missing or malformed
 */
export function requireBaseUrl(
  raw: string | null | undefined,
  source: string,
): string {
  const normalized = normalizeBaseUrl(raw);
  if (normalized) return normalized;

  throw new Error(
    `Invalid email base URL for ${source}: expected an absolute http(s) URL, ` +
      `received ${describeValue(raw)}. Every link in every email is built from ` +
      `this value, so a malformed base URL produces links the recipient cannot ` +
      `click. Set ${source} to the app origin (for example ` +
      `https://dev.mentorships.huckleberry.art).`,
  );
}
