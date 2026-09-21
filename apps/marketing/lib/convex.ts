import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";

export function getConvexClient(): ConvexHttpClient {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

export async function getAuthenticatedConvexClient(): Promise<ConvexHttpClient> {
  const client = getConvexClient();
  const clerkAuth = await auth();
  if (!clerkAuth.userId) {
    throw new Error("Not authenticated");
  }
  const token = await clerkAuth.getToken({ template: "convex" });
  if (!token) {
    throw new Error("Failed to obtain Convex JWT from Clerk");
  }
  client.setAuth(token);
  return client;
}
