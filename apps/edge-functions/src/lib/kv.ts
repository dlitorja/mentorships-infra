import type { Env } from "./env";
import { getJwtExpirationSeconds } from "./token";

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

export async function cacheKey(token: string, authToken?: string): Promise<string> {
  if (authToken) {
    // Key the cache by the authenticated token itself. This prevents one caller
    // from selecting another user's cached entry, while remaining stable for the
    // lifetime of the token. The token is hashed so it is never stored as a KV
    // key in plain text.
    const hash = await sha256Hex(authToken);
    return `share:${token}:token:${hash}`;
  }
  return `share:${token}`;
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function revocationKey(token: string): string {
  return `revoked:share:${token}`;
}

export function getCacheTtlSeconds(env: Env): number {
  const parsed = Number(env.SHARE_CACHE_TTL_SECONDS);
  if (Number.isNaN(parsed) || parsed <= 0) return 3600;
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
  authToken?: string
): Promise<ResolveShareCacheResult | null> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return null;

  const key = await cacheKey(token, authToken);

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
  authToken: string | undefined,
  data: CachedShare
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  // Do not cache expired entries.
  if (isCachedShareExpired(data)) return;

  const tokenExpirationSeconds = authToken
    ? getJwtExpirationSeconds(authToken)
    : undefined;
  const ttlSeconds = computeCacheTtlSeconds(
    env,
    data.expiresAt ?? null,
    tokenExpirationSeconds
  );
  const key = await cacheKey(token, authToken);
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

  // Ensure the revocation marker lives at least as long as the longest possible
  // authenticated cache entry, plus a small buffer, so it cannot expire before
  // the entries it protects.
  const markerTtl = Math.max(
    (ttlSeconds ?? 0) || getCacheTtlSeconds(env) + 3600,
    getCacheTtlSeconds(env) + 3600
  );
  await kv.put(revocationKey(token), "1", { expirationTtl: markerTtl });
}

export async function clearShareRevokedCache(
  env: Env,
  token: string
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  await kv.delete(revocationKey(token));
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

export async function deleteCachedShareForToken(
  env: Env,
  token: string,
  authToken: string
): Promise<void> {
  const kv = env.SHARE_CACHE_KV_NAMESPACE;
  if (!kv) return;

  const key = await cacheKey(token, authToken);
  await kv.delete(key);
}
