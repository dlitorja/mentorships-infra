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
 */
export async function verifyConvexToken(
  token: string,
  env: Env
): Promise<VerifiedConvexToken | null> {
  const secretKey = env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  try {
    const verified = await verifyToken(token, { secretKey });
    if (!verified.sub || typeof verified.exp !== "number") {
      return null;
    }
    return {
      userId: verified.sub,
      expirationSeconds: verified.exp,
    };
  } catch {
    return null;
  }
}
