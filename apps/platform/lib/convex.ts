import { ConvexHttpClient } from "convex/browser";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import { UnauthorizedError } from "@/lib/errors";

export function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Returns a Convex HTTP client authenticated with the current user's Clerk JWT.
 * Throws {@link UnauthorizedError} if no token is available, so callers can
 * surface a 401 consistently.
 */
export async function getAuthenticatedConvexClient(): Promise<ConvexHttpClient> {
  const client = getConvexClient();
  const token = await getConvexAuthToken();
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }
  client.setAuth(token);
  return client;
}
