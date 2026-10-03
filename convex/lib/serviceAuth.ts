/**
 * Shared server-to-server auth for privileged Convex mutations.
 *
 * These mutations are invoked by trusted server contexts (Inngest functions,
 * Next.js API routes, Convex HTTP actions, one-shot scripts) that cannot
 * carry a user JWT, so `ctx.auth` is not available. The caller passes a
 * `serviceKey` arg, which must match the `CONVEX_HTTP_KEY` env var configured
 * on the Convex deployment.
 *
 * The check fails closed: if the env var is unset, every call is rejected.
 *
 * CONVEX_HTTP_KEY is reused (already distributed to Inngest / Trigger.dev /
 * Vercel envs for the Convex HTTP routes) so no new secret needs provisioning.
 * Do NOT use this for user-initiated actions — those must go through
 * `ctx.auth.getUserIdentity()` instead.
 */

export function assertServiceKey(provided: string | undefined): void {
  const expected = process.env.CONVEX_HTTP_KEY;
  if (!expected) {
    throw new Error(
      "CONVEX_HTTP_KEY is not configured; refusing privileged mutation"
    );
  }
  if (provided === undefined || provided.length !== expected.length) {
    throw new Error("Unauthorized: invalid service key");
  }
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) {
    throw new Error("Unauthorized: invalid service key");
  }
}
