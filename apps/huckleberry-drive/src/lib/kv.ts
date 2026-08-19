interface RevokeShareResult {
  shareId: string;
  revokedAt: number;
}

/**
 * Revoke a share via the Cloudflare Worker, which both commits the Convex
 * mutation and immediately writes the KV revocation marker. Keeping the two
 * steps in the same request means the share cannot be revoked in Convex
 * without the marker being set.
 */
export async function revokeShareViaWorker(
  token: string,
  convexToken: string
): Promise<RevokeShareResult> {
  const workerUrl = process.env.NEXT_PUBLIC_EDGE_FUNCTIONS_URL;
  const internalKey = process.env.SHARE_CACHE_INVALIDATION_KEY;

  if (!workerUrl || !internalKey) {
    throw new Error(
      "Share cache invalidation is not configured. Set NEXT_PUBLIC_EDGE_FUNCTIONS_URL and SHARE_CACHE_INVALIDATION_KEY."
    );
  }

  const response = await fetch(
    `${workerUrl.replace(/\/$/, "")}/internal/shares/${encodeURIComponent(token)}/revoke`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalKey}`,
      },
      body: JSON.stringify({ convexToken }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(`Share revocation failed: ${response.status} ${body}`);
  }

  return (await response.json()) as RevokeShareResult;
}

/**
 * Invalidate the share-link KV cache in the Cloudflare Worker after extension.
 * Called after a successful extend mutation so the unauthenticated cache
 * entry is refreshed. Throws if the Worker cannot be reached so the caller can
 * surface the error.
 */
export async function invalidateShareCache(
  token: string,
  action: "revoke" | "extend"
): Promise<void> {
  const workerUrl = process.env.NEXT_PUBLIC_EDGE_FUNCTIONS_URL;
  const internalKey = process.env.SHARE_CACHE_INVALIDATION_KEY;

  if (!workerUrl || !internalKey) {
    throw new Error(
      "Share cache invalidation is not configured. Set NEXT_PUBLIC_EDGE_FUNCTIONS_URL and SHARE_CACHE_INVALIDATION_KEY."
    );
  }

  const response = await fetch(
    `${workerUrl.replace(/\/$/, "")}/internal/cache/invalidate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalKey}`,
      },
      body: JSON.stringify({ token, action }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(
      `Share cache invalidation failed: ${response.status} ${body}`
    );
  }
}
