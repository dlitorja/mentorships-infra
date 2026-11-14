/**
 * Route patterns that require an authenticated session.
 *
 * Consumed by `proxy.ts` through `createRouteMatcher`. Without a matching
 * pattern the middleware lets the request through, the page's
 * `requireAuth()` / `requireRole()` throws `UnauthorizedError`, and Next
 * renders a 500 "Application error" page instead of bouncing the visitor
 * to `/sign-in` — signed-out users then have no path back into the app.
 *
 * The list lives here (rather than inline in the middleware) so
 * `lib/protected-routes.test.ts` can assert that every page which calls
 * `requireAuth()` / `requireRole()` is covered. Add a pattern here when a
 * new authenticated area is introduced.
 *
 * Pattern notes:
 * - Clerk's matcher compiles these with path-to-regexp, so `(.*)` is an
 *   unbounded regex capture: `/instructor(.*)` would also match the public
 *   `/instructors` directory. Use `:path*`, which matches `/instructor`
 *   and `/instructor/<anything>` but not `/instructors`.
 * - Public pages are matched before protected routes in `proxy.ts`, so an
 *   accidental overlap fails closed to "public" only for the paths listed
 *   in `isPublicPage`.
 */
export const PROTECTED_ROUTE_PATTERNS = [
  "/dashboard(.*)",
  "/instructor/:path*",
  "/admin(.*)",
  "/sessions(.*)",
  "/calendar(.*)",
  "/settings(.*)",
  "/workspace(.*)",
  "/api/checkout(.*)",
  "/api/sessions(.*)",
  "/api/orders(.*)",
  "/api/payments(.*)",
] as const;
