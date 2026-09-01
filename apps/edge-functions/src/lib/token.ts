import { verifyToken } from "@clerk/backend";
import type { Env } from "./env";

export interface VerifiedConvexToken {
  userId: string;
  expirationSeconds: number;
}

/**
 * Verify a Clerk-issued Convex token using the Clerk Backend SDK. Returns the
 * verified user ID and token expiration so the share-link KV cache can be keyed
 * by the authenticated identity and bounded by the token's lifetime.
 *
 * The Worker is shared by `apps/platform` and `apps/huckleberry-drive`, which
 * each have their own Clerk instance. If `CLERK_SECRET_KEY_PLATFORM` is set,
 * it is tried first; otherwise (or on failure) the primary `CLERK_SECRET_KEY`
 * (huckleberry-drive) is used.
 */
export async function verifyConvexToken(
  token: string,
  env: Env
): Promise<VerifiedConvexToken | null> {
  const candidates = [
    env.CLERK_SECRET_KEY_PLATFORM,
    env.CLERK_SECRET_KEY,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (candidates.length === 0) {
    return null;
  }

  let lastError: unknown = null;
  for (const secretKey of candidates) {
    try {
      const verified = await verifyToken(token, { secretKey });
      if (!verified.sub || typeof verified.exp !== "number") {
        continue;
      }
      return {
        userId: verified.sub,
        expirationSeconds: verified.exp,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn("verifyConvexToken: all Clerk instances rejected the token");
  }
  return null;
}
