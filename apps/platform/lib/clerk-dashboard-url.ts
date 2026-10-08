/**
 * Build a deep link to a Clerk user's profile in the Clerk dashboard.
 *
 * Reads NEXT_PUBLIC_CLERK_APP_ID (set via .env.example in the Clerk section)
 * and returns a stable `https://dashboard.clerk.com/apps/{appId}/users/{userId}`
 * URL. Both the publishable key and the app ID are exposed to the browser by
 * design (NEXT_PUBLIC_*), so this helper is safe in client and server contexts.
 *
 * Returns null when the app ID env var is missing so the caller can render the
 * cell with the "Open in Clerk" link disabled. Logs a single warning per missing
 * value per process so misconfigured deployments surface the gap in the
 * browser console.
 *
 * IMPORTANT: read the env var via a literal `process.env.NEXT_PUBLIC_CLERK_APP_ID`
 * lookup. Next.js's `DefinePlugin` only inlines values whose names appear as string
 * literals in the source, so an indirect `process.env[CONSTANT]` lookup always
 * resolves to `undefined` at runtime in the browser bundle.
 */

const CLERK_DASHBOARD_ORIGIN = "https://dashboard.clerk.com";

let warned = false;

export function getClerkDashboardUserUrl(userId: string): string | null {
  const appId = process.env.NEXT_PUBLIC_CLERK_APP_ID;

  if (!appId) {
    if (!warned) {
      warned = true;
      console.warn(
        `[clerk-dashboard-url] NEXT_PUBLIC_CLERK_APP_ID is not set; the "Open in Clerk" link on <ClerkUserIdCell> is disabled. Set it in apps/platform/.env.local and Vercel to enable.`,
      );
    }
    return null;
  }

  return `${CLERK_DASHBOARD_ORIGIN}/apps/${appId}/users/${encodeURIComponent(userId)}`;
}
