// Utilities for cross-app redirects to Platform from the Web app.
// In production, set NEXT_PUBLIC_PLATFORM_URL to the public base URL
// of the Platform app (e.g. https://platform.example.com).
// In development, we fall back to localhost:3000 to match Platform's default.

export function getPlatformBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_PLATFORM_URL) {
    return process.env.NEXT_PUBLIC_PLATFORM_URL;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_PLATFORM_URL must be set in production");
  }

  // Dev fallback mirrors apps/platform/lib/google.ts default
  return "http://localhost:3000";
}
