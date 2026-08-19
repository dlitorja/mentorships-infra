import type { Env } from "../lib/env";
import { callConvexMutation } from "../lib/convex";
import { markShareRevokedCache } from "../lib/kv";
import { logError } from "../lib/observability";

interface RevokeShareLinkResult {
  shareId: string;
  revokedAt: number;
}

/**
 * POST /internal/shares/:token/revoke
 * Internal endpoint used by huckleberry-drive to revoke a share and
 * immediately set the KV revocation marker. The marker is written with its
 * full TTL before the Convex mutation and is never cleared by this endpoint,
 * so failed mutations cannot race with concurrent revokes by clearing a
 * valid marker. On a failed mutation, the marker blocks downloads until it
 * expires; this is a deliberate safety trade-off that prefers false denials
 * over allowing a revoked share to be served from a stale cache.
 */
export async function handleShareRevoke(
  request: Request,
  env: Env,
  token: string
): Promise<Response> {
  const source = "internal/shares/revoke";

  const internalKey = env.SHARE_CACHE_INVALIDATION_KEY;
  if (!internalKey) {
    return new Response("Cache invalidation not configured", { status: 503 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.slice(7) !== internalKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { convexToken?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const convexToken = typeof body.convexToken === "string" ? body.convexToken : undefined;
  if (!convexToken) {
    return new Response("Convex token is required", { status: 400 });
  }

  // Set the revocation marker before committing the Convex mutation so
  // downloads are blocked immediately. The marker uses its full TTL so it
  // remains durable for as long as any cached entry it protects. If the
  // mutation fails, the marker stays in place; the share will be incorrectly
  // blocked until the marker expires, which is preferred over allowing a
  // revoked share to be served from a stale cache entry.
  try {
    await markShareRevokedCache(env, token);
  } catch (error) {
    logError(source, error, "Failed to write revocation marker", { token });
    return new Response("Internal server error", { status: 500 });
  }

  try {
    const result = await callConvexMutation<RevokeShareLinkResult>(
      env,
      "hdShareLinks:revokeShareLink",
      { token },
      convexToken
    );

    if (!result.ok) {
      // Do not clear the marker; see the function comment for the rationale.
      return new Response(
        JSON.stringify({ error: result.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, ...result.value }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logError(source, error, "Failed to revoke share", { token });
    return new Response("Internal server error", { status: 500 });
  }
}
