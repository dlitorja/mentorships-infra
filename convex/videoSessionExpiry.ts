import { ConvexError } from "convex/values";

/**
 * Server-side backstop for Clerk's fixed maximum session lifetime.
 *
 * The client already prompts before joining when `Session.expireAt` lands
 * inside the call window (see
 * `apps/platform/lib/video/session-expiry.ts`). This module enforces the
 * same rule inside Convex so a direct client call cannot bypass the prompt
 * and get halfway into a call that Clerk will interrupt.
 *
 * The Clerk `convex` JWT template includes:
 *
 *   "session_expire_at": "{{session.expire_at}}"
 *
 * `{{session.expire_at}}` is a Unix timestamp in **seconds** (Clerk docs:
 * JWT template shortcodes). Tokens issued before the claim was added, or
 * while Clerk cannot resolve the session, do not have it — those fail OPEN
 * so the rollout does not reject every join. Once present, the claim is
 * authoritative for the life of that token.
 *
 * Keep the constants in sync with:
 *   - apps/platform/lib/video/constants.ts (MAX_CALL_DURATION_MS)
 *   - apps/platform/lib/video/session-expiry.ts
 *     (SESSION_EXPIRY_JOIN_BUFFER_MS)
 */
export const MAX_CALL_DURATION_MS = 4 * 60 * 60 * 1000;
export const SESSION_EXPIRY_JOIN_BUFFER_MS = 15 * 60 * 1000;

type IdentityWithSessionExpiry = {
  session_expire_at?: unknown;
};

/**
 * Parse the `session_expire_at` claim into milliseconds.
 *
 * Accepts any identity object (Convex's `UserIdentity` does not declare an
 * index signature for custom claims) and narrows the claim at runtime.
 *
 * Clerk documents the shortcode as Unix seconds. The `> 1e12` tolerance
 * accepts a millisecond value too, which keeps this correct if the claim
 * is ever populated by a non-Clerk issuer (e.g. a test fixture).
 */
export function getSessionExpireAtMs(identity: object): number | null {
  const raw = (identity as IdentityWithSessionExpiry).session_expire_at;
  const numeric =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1e12 ? numeric : numeric * 1000;
}

/**
 * True when the session is already past its maximum lifetime, or will
 * reach it before a call could end. Returns false for a missing claim
 * (legacy token / rollout window) so the backstop fails open.
 */
export function isSessionExpiringDuringCall(
  expireAtMs: number | null,
  nowMs: number = Date.now()
): boolean {
  if (expireAtMs === null) return false;
  return (
    expireAtMs - nowMs <= MAX_CALL_DURATION_MS + SESSION_EXPIRY_JOIN_BUFFER_MS
  );
}

/**
 * Throws `VIDEO_SESSION_EXPIRING` when the caller's session cannot outlive
 * a call. Call this from every mutation that would otherwise let a user
 * start/join a call (room creation, call start, ad-hoc creation) and from
 * the token-issuing query.
 */
export function assertSessionCanOutliveCall(
  identity: object,
  nowMs: number = Date.now()
): void {
  if (isSessionExpiringDuringCall(getSessionExpireAtMs(identity), nowMs)) {
    throw new ConvexError({
      code: "VIDEO_SESSION_EXPIRING",
      message:
        "Your sign-in has expired or will expire during this call. Sign in again before joining.",
    });
  }
}
