import { MAX_CALL_DURATION_MS } from "@/lib/video/constants";

/**
 * Extra time added to the max call duration when deciding whether a
 * session expiry falls "during" a call. Covers clock skew between the
 * browser and Clerk, the ~50s session-token refresh cadence, and the
 * time it takes the user to move from the prompt back into the call.
 */
export const SESSION_EXPIRY_JOIN_BUFFER_MS = 15 * 60 * 1000;

/**
 * True when the Clerk session's maximum-lifetime expiry (`Session.expireAt`)
 * lands inside the window a call could still be running.
 *
 * Clerk's maximum session lifetime is fixed at creation and is NOT extended
 * by activity (only the short-lived session token is refreshed). On the
 * Hobby plan that lifetime is fixed at 7 days. Without this guard a call
 * that spans the expiry point is interrupted mid-call: Clerk stops issuing
 * tokens, the Convex auth flips, and the next navigation bounces the user
 * to /sign-in.
 *
 * The caller should re-authenticate before joining when this returns true,
 * which mints a brand-new session with a fresh lifetime.
 *
 * Returns false when `expiresAt` is null (Clerk not loaded / signed out) so
 * a transiently unavailable session never blocks a join.
 */
export function willSessionExpireDuringCall(
  expiresAt: Date | null,
  nowMs: number = Date.now(),
  maxCallDurationMs: number = MAX_CALL_DURATION_MS
): boolean {
  if (!expiresAt) return false;
  const msUntilExpiry = expiresAt.getTime() - nowMs;
  // An already-expired session is handled by middleware (the user is
  // redirected to /sign-in before reaching the call UI), so only the
  // "will expire while the call is still running" case is guarded here.
  return msUntilExpiry > 0 && msUntilExpiry <= maxCallDurationMs + SESSION_EXPIRY_JOIN_BUFFER_MS;
}
