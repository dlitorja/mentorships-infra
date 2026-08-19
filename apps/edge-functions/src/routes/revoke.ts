import type { Env } from "../lib/env";
import { callConvexMutation } from "../lib/convex";
import {
  clearShareRevokedCache,
  markShareRevokedCache,
  revocationKey,
} from "../lib/kv";
import { logError } from "../lib/observability";

interface RevokeShareLinkResult {
  shareId: string;
  revokedAt: number;
}

/**
 * POST /internal/shares/:token/revoke
 * Internal endpoint used by huckleberry-drive to revoke a share and
 * immediately set the KV revocation marker. Routing both steps through the
 * Worker keeps the cache-coordination step in the same request as the Convex
 * mutation, so the revoke cannot commit without the marker being written.
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

  // Set the revocation marker before committing the Convex mutation. If the
  // mutation fails, we will clear the marker below. This ordering ensures that
  // downloads are blocked immediately and never remain possible after a
  // successful revoke.
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
      // Roll back the marker if the mutation was rejected by Convex.
      await rollbackRevocationMarker(env, token);
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
    await rollbackRevocationMarker(env, token);
    return new Response("Internal server error", { status: 500 });
  }
}

async function rollbackRevocationMarker(env: Env, token: string): Promise<void> {
  try {
    await clearShareRevokedCache(env, token);
  } catch (firstError) {
    // If deletion fails, overwrite the marker with a value that is not
    // interpreted as revoked and let it expire quickly. This prevents the
    // share from remaining blocked after a failed revoke attempt.
    try {
      const kv = env.SHARE_CACHE_KV_NAMESPACE;
      if (kv) {
        await kv.put(revocationKey(token), "0", { expirationTtl: 1 });
      }
    } catch (secondError) {
      logError("internal/shares/revoke", secondError, "Failed to roll back revocation marker", { token });
    }
  }
}
