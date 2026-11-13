/**
 * Convex publishes two hostnames for the same deployment:
 *
 *   - `<deployment>.convex.cloud` — queries/mutations (and `ConvexHttpClient`)
 *   - `<deployment>.convex.site`  — HTTP actions registered in `convex/http.ts`
 *
 * Trigger tasks that call an HTTP route with the `.convex.cloud` host get
 * `404 No matching routes found`. That is exactly how `notify-recording-ready`
 * broke: it read `NEXT_PUBLIC_CONVEX_URL` verbatim, so every visibility check
 * 404'd while sibling tasks that happened to swap the host kept working.
 *
 * Both derivations live here so a new task cannot forget the swap.
 */

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Base URL for queries/mutations (`ConvexHttpClient`). */
export function getConvexCloudUrl(): string | null {
  const base = (
    process.env.CONVEX_CLOUD_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.CONVEX_DEPLOYMENT_URL ||
    ""
  ).trim();
  if (!base) return null;
  // Accept a site URL here too, so callers can share one env var.
  return stripTrailingSlashes(base).replace(/\.convex\.site$/, ".convex.cloud");
}

/** Base URL for HTTP actions. Prefers an explicit `CONVEX_SITE_URL`. */
export function getConvexSiteUrl(): string | null {
  const explicit = process.env.CONVEX_SITE_URL?.trim();
  if (explicit) return stripTrailingSlashes(explicit);
  const cloud = getConvexCloudUrl();
  return cloud ? cloud.replace(/\.convex\.cloud$/, ".convex.site") : null;
}
