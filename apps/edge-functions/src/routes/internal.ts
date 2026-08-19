import type { Env } from "../lib/env";
import {
  deleteCachedShare,
  deleteCachedSharesForToken,
  markShareRevokedCache,
} from "../lib/kv";
import { logError } from "../lib/observability";

/**
 * POST /internal/cache/invalidate
 * Internal endpoint used by huckleberry-drive to invalidate a share-link KV
 * cache entry after revocation or extension. Requires the shared internal key
 * passed in the Authorization header.
 */
export async function handleCacheInvalidation(
  request: Request,
  env: Env
): Promise<Response> {
  const source = "internal/cache/invalidate";

  const internalKey = env.SHARE_CACHE_INVALIDATION_KEY;
  if (!internalKey) {
    return new Response("Cache invalidation not configured", { status: 503 });
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.slice(7) !== internalKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { token?: unknown; action?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = typeof body.action === "string" ? body.action : "revoke";
  if (!token || token.length < 16) {
    return new Response("Invalid token", { status: 400 });
  }
  if (action !== "revoke" && action !== "extend") {
    return new Response("Invalid action; expected 'revoke' or 'extend'", {
      status: 400,
    });
  }

  try {
    if (action === "revoke") {
      // Set a shared revocation marker so all per-token cached entries are
      // rejected on their next read, regardless of whether we can enumerate them.
      await markShareRevokedCache(env, token);
    }
    if (action === "extend") {
      // Remove every cached entry for this token (both unauthenticated and
      // per-user) so a stale expiry or authorization decision cannot survive
      // the extension.
      await deleteCachedSharesForToken(env, token);
    } else {
      // Also remove the unauthenticated cache entry so the next read falls
      // back to Convex, which will report the revocation.
      await deleteCachedShare(env, token);
    }
  } catch (error) {
    logError(source, error, "Failed to invalidate share cache", { token, action });
    return new Response("Internal server error", { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
