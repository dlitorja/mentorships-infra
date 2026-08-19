import type { Env } from "./env";

/**
 * Shared helpers for the share-link metadata KV cache.
 *
 * The cache trades immediate consistency for read performance. Cached
 * entries are bounded by:
 *
 * - The verified Clerk token's remaining lifetime, so a token expiry ends
 *   access for the holder of that token.
 * - The share's authoritative expiration timestamp, so a shortened expiry
 *   eventually takes effect.
 * - The configured SHARE_CACHE_TTL_SECONDS ceiling (default 5 minutes).
 *
 * Known race windows that this design accepts:
 *
 * - A share revoked in Convex while a cached entry exists is blocked by the
 *   per-token revocation marker, which is written before the Convex mutation
 *   and outlives every cached entry. The marker is never cleared by the
 *   revoke endpoint, so concurrent revokes cannot race.
 * - A share whose expiry is shortened (extended to an earlier time) may have
 *   a cached entry from before the change. The token-prefix invalidation in
 *   handleCacheInvalidation lists and deletes every matching key before the
 *   mutation commits, but a cache writer that races the listing can still
 *   leave a stale entry. The bounded TTL limits this window.
 * - A user's role change is not propagated to the cache; the cached entry
 *   trusts the role check that was authoritative at resolve time. The bounded
 *   TTL limits this window.
 *
 * These trade-offs are documented so future reviewers understand why a more
 * strict consistency model is not used.
 */

export interface CachedShare {
  shareId: string;
  createdByUserId: string;
  createdAt: number;
  expiresAt: number | null;
  label: string | null;
  upload: {
    id: string;
    filename: string;
    originalName: string;
    contentType: string;
    size: number;
  };
}

export interface ResolveShareCacheResult {
  kind: "ok";
  shareId: string;
  upload: {
    id: string;
    filename: string;
    originalName: string;
    contentType: string;
    size: number;
  };
  label: string | null;
}

export async function cacheKey(
  token: string,
  userId?: string
): Promise<string> {
  if (userId) {
    // Key the cache by the verified user ID so one caller cannot select
    // another user's cached entry.
    return `share:${token}:user:${userId}`;
  }
  return `share:${token}`;
}

export function revocationKey(token: string): string {
  return `revoked:share:${token}`;
}

export function getCacheTtlSeconds(env: Env): number {
  const parsed = Number(env.SHARE_CACHE_TTL_SECONDS);
  if (Number.isNaN(parsed) || parsed <= 0) return 300;
  return parsed;
}

export function computeCacheTtlSeconds(
  env: Env,
  expiresAt: number | null,
  tokenExpirationSeconds?: number
): number {
  const maxTtl = getCacheTtlSeconds(env);
  const candidates: number[] = [maxTtl];

  if (expiresAt !== null) {
    const remainingSeconds = Math.floor((expiresAt - Date.now()) / 1000);
    // Expired shares are not cached; they will be rejected before this path.
    if (remainingSeconds <= 0) return 60;
    candidates.push(remainingSeconds);
  }

  if (tokenExpirationSeconds !== undefined) {
    const remainingTokenLifetime =
      tokenExpirationSeconds - Math.floor(Date.now() / 1000);
    candidates.push(Math.max(1, remainingTokenLifetime));
  }

  return Math.min(...candidates);
}

export function isCachedShareExpired(cached: CachedShare): boolean {
  if (cached.expiresAt === null) return false;
  return cached.expiresAt <= Date.now();
}

export async function getCachedShare(
  env: Env,
  token: string,
  userId?: string
): Promise<ResolveShareCacheResult | null> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return null;

  const key = await cacheKey(token, userId);

  try {
    const cached = await kv.get<CachedShare>(key, "json");
    if (!cached) return null;
    if (!cached.shareId || !cached.upload?.filename) return null;

    // Re-check expiration at read time in case the entry was written with a
    // TTL near the share expiration boundary.
    if (isCachedShareExpired(cached)) {
      try {
        await kv.delete(key);
      } catch {
        // Ignore cleanup failures.
      }
      return null;
    }

    return {
      kind: "ok",
      shareId: cached.shareId,
      upload: cached.upload,
      label: cached.label ?? null,
    };
  } catch {
    return null;
  }
}

export async function setCachedShare(
  env: Env,
  token: string,
  userId: string | undefined,
  tokenExpirationSeconds: number | undefined,
  data: CachedShare
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  // Do not cache expired entries.
  if (isCachedShareExpired(data)) return;

  const ttlSeconds = computeCacheTtlSeconds(
    env,
    data.expiresAt ?? null,
    tokenExpirationSeconds
  );
  const key = await cacheKey(token, userId);
  try {
    await kv.put(key, JSON.stringify(data), {
      expirationTtl: ttlSeconds,
    });
  } catch {
    // Cache population is best-effort; do not fail the request.
  }
}

export async function isShareRevokedCache(
  env: Env,
  token: string
): Promise<boolean> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return false;

  try {
    const value = await kv.get(revocationKey(token));
    return value === "1";
  } catch {
    // Fail open on the side of safety: if we cannot read the revocation marker,
    // treat the share as revoked so we do not serve a cached download.
    return true;
  }
}

export async function markShareRevokedCache(
  env: Env,
  token: string,
  ttlSeconds?: number
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  // Use the explicit TTL if provided. Otherwise, ensure the marker lives at
  // least as long as the longest possible authenticated cache entry, plus a
  // small buffer, so it cannot expire before the entries it protects.
  const markerTtl = ttlSeconds ?? getCacheTtlSeconds(env) + 3600;
  await kv.put(revocationKey(token), "1", { expirationTtl: markerTtl });
}

export async function deleteCachedShare(
  env: Env,
  token: string
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  // We don't know which authenticated tokens have cached entries, so we can
  // only delete the unauthenticated key. Authenticated entries are invalidated
  // via the shared revocation marker and their own TTL. Delete the
  // unauthenticated key for safety.
  const key = await cacheKey(token);
  await kv.delete(key);
}

export async function deleteCachedSharesForToken(
  env: Env,
  token: string
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  // Enumerate all cached entries for this token (both unauthenticated and
  // per-user) and delete them so extension invalidation cannot leave behind
  // an entry with stale expiry or authorization.
  const prefix = `share:${token}`;
  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix, cursor, limit: 1000 });
    const keys = list.keys.map((entry) => entry.name);
    if (keys.length > 0) {
      await Promise.all(keys.map((name) => kv.delete(name)));
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}

export async function deleteCachedShareForUser(
  env: Env,
  token: string,
  userId: string
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  const key = await cacheKey(token, userId);
  await kv.delete(key);
}
