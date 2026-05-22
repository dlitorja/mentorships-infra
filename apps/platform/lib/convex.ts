import { ConvexHttpClient } from "convex/browser";

export function getConvexClient() {
  // Normalize Convex URL by trimming trailing slashes to avoid double "//api" paths
  const convexUrl = (process.env.NEXT_PUBLIC_CONVEX_URL || "").replace(/\/+$/, "");
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}
