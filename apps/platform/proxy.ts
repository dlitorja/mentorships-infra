import { clerkClient, clerkMiddleware, createRouteMatcher, type ClerkMiddlewareAuth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { protectWithRateLimit, type RateLimitPolicy } from "@/lib/ratelimit";

import { reportError, reportInfo } from "@/lib/observability";

/**
 * Strip trailing slash from URL for consistent comparison
 */
function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Allowed origins for CSRF protection
 * Validates Origin header on state-changing requests
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  
  // Primary app URL (normalize to handle trailing slashes)
  if (process.env.NEXT_PUBLIC_URL) {
    origins.push(normalizeUrl(process.env.NEXT_PUBLIC_URL));
  }
  
  // Vercel deployment URLs
  if (process.env.VERCEL_URL) {
    origins.push(normalizeUrl(`https://${process.env.VERCEL_URL}`));
  }
  
  // Additional allowed origins from environment
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(...process.env.ALLOWED_ORIGINS.split(",").map(o => normalizeUrl(o.trim())));
  }
  
  // Local development - allow common dev ports and hostnames
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
    origins.push("http://localhost:3001", "http://127.0.0.1:3001");
    origins.push("http://localhost:3002", "http://127.0.0.1:3002");
    // Allow any localhost port in development (wildcard approach)
    origins.push("http://localhost:*");
  }
  
  return origins;
}

/**
 * Check if origin matches allowed origins, including wildcard patterns
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  // Normalize origin for comparison (handle trailing slashes)
  const normalizedOrigin = normalizeUrl(origin);
  
  // Direct match
  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }
  
  // Wildcard matching for development (e.g., "http://localhost:*")
  for (const allowed of allowedOrigins) {
    if (allowed.endsWith(":*")) {
      const prefix = allowed.slice(0, -1); // "http://localhost:"
      if (origin.startsWith(prefix)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if request requires CSRF validation
 * Only applies to state-changing methods on authenticated API routes
 */
function requiresCSRFValidation(req: NextRequest, isPublicRoute: boolean): boolean {
  // Skip CSRF for public routes (webhooks, health checks, etc.)
  if (isPublicRoute) return false;
  
  // Only validate state-changing methods
  const stateChangingMethods = ["POST", "PUT", "PATCH", "DELETE"];
  if (!stateChangingMethods.includes(req.method)) return false;
  
  // Only validate API routes
  if (!req.nextUrl.pathname.startsWith("/api/")) return false;
  
  return true;
}

/**
 * Validate Origin header for CSRF protection
 * Returns null if valid, NextResponse if invalid
 */
async function validateCSRFOrigin(req: NextRequest): Promise<NextResponse | null> {
  const origin = req.headers.get("origin");
  const allowedOrigins = getAllowedOrigins();
  
  // If no origin header, check for alternative indicators
  if (!origin) {
    // In development, also check Host header as fallback - but only for known safe dev hosts
    if (process.env.NODE_ENV !== "production") {
      const host = req.headers.get("host");
      if (host) {
        // Only allow Host header fallback for explicit localhost/127.0.0.1 dev hosts
        // This prevents potential Host header spoofing in shared environments
        const safeDevHosts = ["localhost", "127.0.0.1"];
        const hostParts = host.split(":")[0]; // Remove port
        if (safeDevHosts.includes(hostParts)) {
          const possibleOrigins = [
            `http://${host}`,
            `https://${host}`,
          ];
          for (const possibleOrigin of possibleOrigins) {
            if (isOriginAllowed(possibleOrigin, allowedOrigins)) {
              return null;
            }
          }
        }
      }
    }

    // Allow requests without Origin header if they have a Referer from same site
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (isOriginAllowed(refererOrigin, allowedOrigins)) {
          return null;
        }
      } catch {
        // Malformed Referer — treat as missing, fall through to rejection
      }
    }

    // Requests with Bearer token are CSRF-safe (token-based auth is inherently non-forgeable)
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return null;
    }

    // Reject state-changing requests without origin or referer
    return NextResponse.json(
      { error: "CSRF validation failed: Origin header required" },
      { status: 403 }
    );
  }
  
  // Check if origin is in allowed list
  if (!isOriginAllowed(origin, allowedOrigins)) {
    await reportError({
      source: "proxy.csrf",
      error: new Error("Blocked request from unauthorized origin"),
      message: "CSRF validation failed: Unauthorized origin",
      level: "warn",
      context: { origin, pathname: req.nextUrl.pathname, method: req.method },
    });
    return NextResponse.json(
      { error: "CSRF validation failed: Unauthorized origin" },
      { status: 403 }
    );
  }
  
  return null;
}

/**
 * Define protected routes that require authentication
 * Routes matching these patterns will require the user to be signed in
 */
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/admin(.*)",
  "/sessions(.*)",
  "/calendar(.*)",
  "/settings(.*)",
  "/workspace(.*)",
  "/api/checkout(.*)",
  "/api/sessions(.*)",
  "/api/orders(.*)",
  "/api/payments(.*)",
]);

/**
 * Define admin routes that require admin role
 * Routes matching these patterns will require the user to have admin role
 */
const isAdminRoute = createRouteMatcher([
  "/admin(.*)",
]);

/**
 * PR 12 PR E (Follow-up) — Onboarding gate path matchers.
 *
 * The "gated" set is the set of protected routes that a student
 * who has not yet completed onboarding MUST NOT be allowed to
 * navigate to. Currently: workspace, sessions, calendar, settings,
 * AND the `/dashboard/workspaces/[id]` deep-link surface that the
 * admin-onboarding student email renders (R6 / PR 15). Without
 * the deep-link, a student could open the workspace from the
 * onboarding email without finishing the questionnaire.
 *
 * The dashboard and onboarding pages stay open as the "soft gate"
 * surface (banner + CTA). The list of instructors (browsing
 * mentors) is intentionally NOT gated so a student who has been
 * invited but never finished questionnaire can still discover
 * their match before being forced to write answers.
 */
const isOnboardingGatedPath = createRouteMatcher([
  "/workspace(.*)",
  "/sessions(.*)",
  "/calendar(.*)",
  "/settings(.*)",
  "/dashboard/workspaces/(.*)", // R6: admin-onboarding email deep-link
]);

/**
 * Pages that are always allowed even when the onboarding gate would
 * otherwise trip — the student lands here to finish setup. Note the
 * `/dashboard` exception is intentionally narrow (NO `(.*)`); the
 * workspace deep-link under `/dashboard/workspaces/...` lives in
 * the gated set above.
 */
const isOnboardingAllowedPath = createRouteMatcher([
  "/dashboard", // bare root only; sub-paths (workspaces, instructor) are gated
  "/onboarding(.*)",
  "/instructors(.*)", // browse pages are always open
  "/settings/identity(.*)", // allow password reset / sign-out
]);

/**
 * Define public API routes that don't require authentication
 * (e.g., webhooks, public endpoints)
 */
const isPublicApiRoute = createRouteMatcher([
  "/api/webhooks(.*)",
  "/api/health",
  "/api/errors", // Client-side error forwarding endpoint
  "/api/inngest(.*)", // Inngest dev server needs unauthenticated access
  "/api/seats/availability(.*)", // Public seat availability endpoint
  "/api/contacts", // Public contact form endpoint
  "/api/waitlist", // Allows unauth POST (GET route enforces auth itself)

  // Public checkout endpoints: we collect email/name and upsert user on server
  // CSRF and rate limits still apply before route execution
  "/api/checkout(.*)",

  // PR-E (Issue 5): the bounce-redirect route handler sets an
  // HttpOnly cookie with the requested destination and 307s to
  // bare /sign-in. Rate-limiting still applies (auth policy at
  // line 299). The cookie is short-TTL, scoped to /auth-redirect,
  // and only persists paths that pass the auth-redirect whitelist
  // (`whitelistedRedirectValue` in `app/auth-redirect/page.tsx`).
  // Excluding this here would break Greptile round-2 P1 (signed-
  // out recipients get a 401 instead of the bounce cookie).
  "/api/auth/bounce-redirect",
]);

/**
 * Define public pages that don't require authentication
 */
const isPublicPage = createRouteMatcher([
  "/",
  "/mentors(.*)",
  "/about(.*)",
  "/pricing(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/auth-redirect(.*)",
  "/test(.*)", // Test page for verification
]);

// Check if Clerk is configured
const hasClerkKey = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder_for_build_time_only" &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_")
);

/**
 * Authenticated request handler for the Clerk-enabled middleware path.
 * Applies rate limiting, CSRF checks, and route-level access control.
 */
async function middlewareHandler(auth: ClerkMiddlewareAuth, req: NextRequest) {
  const authResult = await auth();
  const userId = authResult.userId;

  let userRole: string | undefined;

  if (userId && isAdminRoute(req)) {
    const claimsRole = (authResult.sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
    if (typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)) {
      userRole = claimsRole;
    } else {
      try {
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(userId);
        const role = clerkUser.publicMetadata?.role;
        userRole = typeof role === "string" ? role : undefined;
      } catch (clerkError) {
        await reportError({
          source: "proxy.middleware",
          error: clerkError instanceof Error ? clerkError : new Error(String(clerkError)),
          message: "Failed to fetch user role from Clerk API",
          level: "warn",
          context: { userId },
        });
      }
    }
  }

  const pathname = req.nextUrl.pathname;
  const method = req.method;

  // Apply rate limiting to API routes (method-aware policy matrix)
  // Note: We intentionally skip /api/inngest (dev server) and /api/health (monitoring).
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/inngest") &&
    pathname !== "/api/health"
  ) {
        const { policy, requested }: { policy: RateLimitPolicy; requested: number } = (() => {
      // Webhooks: public, but protect against request floods.
      if (pathname.startsWith("/api/webhooks/")) {
        return { policy: "webhook", requested: 1 };
      }

      // Public client-side error forwarding endpoint.
      if (pathname === "/api/errors") {
        return { policy: "default", requested: 1 };
      }

      // Public marketing endpoints.
      if (pathname === "/api/contacts" || pathname === "/api/waitlist") {
        return { policy: "forms", requested: method === "POST" ? 1 : 1 };
      }

      // Availability endpoints (read-heavy).
      if (
        pathname.startsWith("/api/seats/availability/") ||
        (pathname.startsWith("/api/instructors/") && pathname.endsWith("/availability"))
      ) {
        return { policy: "availability", requested: 1 };
      }

      // Auth endpoints (OAuth + user sync).
      if (pathname.startsWith("/api/auth/")) {
        return { policy: "auth", requested: 1 };
      }

      // Checkout endpoints (payment creation/verification).
      if (pathname.startsWith("/api/checkout/")) {
        return { policy: userId ? "checkout" : "default", requested: 1 };
      }

      // Booking is only POST /api/sessions (expensive operation).
      if (pathname === "/api/sessions" && method === "POST") {
        return { policy: userId ? "booking" : "default", requested: 1 };
      }

      // Instructor management endpoints.
      if (pathname.startsWith("/api/instructor/")) {
        return { policy: userId ? "instructor" : "default", requested: 1 };
      }

      // Default: use per-user buckets when authenticated, otherwise per-IP.
      return { policy: userId ? "user" : "default", requested: 1 };
    })();

    const rateLimitResponse = await protectWithRateLimit(req, { policy, userId, requested });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  // Allow public API routes (webhooks, health checks, etc.)
  if (isPublicApiRoute(req)) {
    return NextResponse.next();
  }

  // CSRF Protection: Validate Origin header for state-changing API requests
  if (requiresCSRFValidation(req, false)) {
    const csrfError = await validateCSRFOrigin(req);
    if (csrfError) {
      return csrfError;
    }
  }

  // Allow public pages
  if (isPublicPage(req)) {
    return NextResponse.next();
  }

  // Protect API routes (except public ones)
  if (req.nextUrl.pathname.startsWith("/api/")) {
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // Protect pages that require authentication
  if (isProtectedRoute(req)) {
    if (!userId) {
      // Redirect to sign-in page
      const signInUrl = new URL("/sign-in", req.url);
      signInUrl.searchParams.set("redirect_url", req.url);
      return NextResponse.redirect(signInUrl);
    }

    // Check admin role for admin routes
    if (isAdminRoute(req) && userRole !== "admin") {
      const dashboardUrl = new URL("/dashboard", req.url);
      dashboardUrl.searchParams.set("error", "unauthorized");
      return NextResponse.redirect(dashboardUrl);
    }

    // Redirect instructors from /dashboard to /instructor/dashboard
    if (pathname === "/dashboard" && userId) {
      let role: string | undefined;
      const claimsRole = (authResult.sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
      if (typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)) {
        role = claimsRole;
      } else {
        try {
          const clerk = await clerkClient();
          const clerkUser = await clerk.users.getUser(userId);
          const roleMeta = clerkUser.publicMetadata?.role;
          role = typeof roleMeta === "string" ? roleMeta : undefined;
        } catch {
          // Default to undefined, will allow access to /dashboard
        }
      }
      if (role === "instructor") {
        return NextResponse.redirect(new URL("/instructor/dashboard", req.url));
      }
    }

    // PR 12 PR E (Follow-up) — Student onboarding gate.
    //
    // A student who has a freshly-claimed row but has not yet
    // submitted the onboarding questionnaire must not be allowed
    // past the gated paths (`/workspace`, `/sessions`, etc.) on
    // the assumption that those worksurfaces depend on answers
    // that's not on file yet.
    //
    // Skip conditions:
    //   - `TEST_WEBHOOK_BYPASS=true` — Kernel-backed Playwright
    //     project runs E2E without finished state, so we read the
    //     same env var used by the webhook route and fall through.
    //     Is named after a webhook variable because the gate was
    //     designed alongside the Stripe webhook rework.
    //   - instructor/admin/support roles — the gate only applies
    //     to students.
    //   - paths the gate is ALLOWED through (dashboard, onboarding,
    //     /instructors browse, /settings/identity).
    //
    // Greptile P2 follow-up: observability calls (`reportInfo` /
    // `reportError`) can include `await sendToAxiom(...)` which has
    // a ~3s timeout in production. Awaiting synchronously in the
    // gate path adds latency after the gate's 800ms budget has
    // already elapsed. Fire-and-forget (`.catch(() => {})`) on each
    // call so the response returns immediately while the log lands
    // asynchronously. The observability helpers already swallow
    // errors internally, so the failure mode is "no log line", not
    // a student 500.
    type GateEnv = {
      requiresOnboardingCompletion: boolean;
      onboardingId: string | null;
      rowStatus: string | null;
      questionnaireSubmitted: boolean;
      reason: string | null;
    };

    if (
      userId &&
      isOnboardingGatedPath(req) &&
      !isOnboardingAllowedPath(req) &&
      process.env.TEST_WEBHOOK_BYPASS !== "true"
    ) {
      try {
        // Hit Convex for the gate decision. The query is READ-ONLY —
        // `ctx.runMutation` is forbidden in queries, so the caller-
        // side self-heal claim runs FIRST so a freshly-signed-up
        // student gets matched to their row even before the Clerk
        // webhook lands. Both calls plus the role lookup are wrapped
        // in a single 800ms timeout race so a Clerk SDK stall, a
        // Convex outage, or any combination cannot push past the
        // budget. Default to allow on timeout (loud telemetry, not
        // a 500 on the student).
        //
        // Greptile round-9 P2: the role-lookup path (`clerk.users.getUser`)
        // used to run BEFORE the race started, so a slow Clerk API
        // could push the whole gate way past 800ms. The role check,
        // the missing-claim instructor probe, the claim mutation,
        // and the gate query all live inside `gateCheck()` now so
        // the deadline covers the entire chain.
        const TIMEOUT_SENTINEL = { __timeout: true } as const;
        type TimeoutSentinel = typeof TIMEOUT_SENTINEL;
        const gateCheck = async (): Promise<GateEnv | null> => {
          // Resolve the role. We don't gate instructors / admins
          // / support — students trip the gate, everyone else
          // bypasses.
          //
          // Greptile round-1 P1: a missing-role user must default
          // to "student" (matching `getServerUserRole` in
          // `lib/auth-helpers.ts`) rather than passing through
          // silently. Without this, a student whose Clerk
          // `publicMetadata.role` is unset — common for legacy /
          // admin-created accounts (HUC-47) — would skip the gate
          // on every navigation.
          const claimsRoleRaw = (authResult.sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
          const claimsRole =
            typeof claimsRoleRaw === "string" ? claimsRoleRaw : undefined;
          let role: string | undefined = claimsRole;
          if (!role) {
            try {
              const clerk = await clerkClient();
              const clerkUser = await clerk.users.getUser(userId);
              role = typeof clerkUser.publicMetadata?.role === "string"
                ? clerkUser.publicMetadata.role
                : undefined;
            } catch {
              // Mirror `getServerUserRole` exactly: even on Clerk
              // API failure, default to "student" so we don't lose
              // a gated student to a transient outage.
              role = "student";
            }
          }
          if (!role) {
            role = "student";
          }

          if (role !== "student") return null;

          // Greptile round-5 P1: when `role` resolved to "student"
          // purely because the Clerk `publicMetadata.role` claim
          // is missing, probe the Convex `instructors` table for
          // an active record before defaulting. A legacy
          // instructor whose Clerk role key was never written
          // (common for admin-created accounts, see HUC-47)
          // would otherwise get redirected into their old
          // student-shape questionnaire. The probe is gated to
          // the missing-claim case, so the production hot path
          // is unchanged.
          if (!claimsRole) {
            try {
              const probeToken = await authResult.getToken({ template: "convex" });
              if (probeToken) {
                const { ConvexHttpClient } = await import("convex/browser");
                const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
                if (convexUrl) {
                  const probeClient = new ConvexHttpClient(convexUrl);
                  probeClient.setAuth(probeToken);
                  const { api } = await import("@/convex/_generated/api");
                  // Greptile round-6 P1: filter out soft-deleted
                  // instructor records — `getInstructorByUserId`
                  // returns them too, but a soft-deleted
                  // instructor shouldn't bypass the student
                  // gate (otherwise a former instructor can
                  // slip through the onboarding check). Mirror
                  // `hasInstructorRecord` in
                  // `lib/auth-helpers.ts` exactly.
                  const instructorRecord = (await probeClient.query(
                    api.instructors.getInstructorByUserId,
                    { userId },
                  )) as { _id: string; deletedAt?: number } | null;
                  if (instructorRecord && instructorRecord.deletedAt === undefined) {
                    // Verified ACTIVE instructor with no Clerk
                    // role claim — bypass the gate entirely.
                    // Mirrors the same convention that
                    // `hasInstructorRecord` uses to widen access
                    // for admin-created instructor accounts.
                    return null;
                  }
                }
              }
            } catch {
              // Convex outage for the instructor-record probe:
              // fall through; role stays at the existing default
              // (matches the no-publicMetadata role fallback).
            }
          }

          const token = await authResult.getToken({ template: "convex" });
          if (!token) return null;
          const { ConvexHttpClient } = await import("convex/browser");
          const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
          if (!convexUrl) return null;
          const client = new ConvexHttpClient(convexUrl);
          client.setAuth(token);
          const { api } = await import("@/convex/_generated/api");
          await client
            .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {})
            .catch(() => null);
          return (await client.query(
            api.adminOnboarding.getStudentOnboardingGateForCurrentUser,
            {}
          )) as GateEnv | null;
        };
        const raced: GateEnv | null | TimeoutSentinel =
          await Promise.race<GateEnv | null | TimeoutSentinel>([
            gateCheck(),
            new Promise<TimeoutSentinel>((resolve) =>
              setTimeout(() => resolve(TIMEOUT_SENTINEL), 800),
            ),
          ]);
        let gate: GateEnv | null;
        if (raced === TIMEOUT_SENTINEL) {
          // Greptile P2 follow-up: fire-and-forget the
          // observability call so we don't add latency after
          // the 800ms budget has already elapsed. See block
          // comment above for rationale.
          void reportError({
            source: "proxy.onboarding-gate",
            error: new Error(
              "Convex gate query exceeded 800ms budget; falling through to allow",
            ),
            message:
              "Onboarding gate check timed out — request allowed past gate on best-effort basis",
            level: "warn",
            context: { userId, pathname },
          }).catch(() => null);
          gate = null;
        } else {
          // `raced` is narrowed to `GateEnv | null` here.
          gate = raced as GateEnv | null;
        }

        if (gate?.requiresOnboardingCompletion && gate.onboardingId) {
          // Greptile P2 follow-up: fire-and-forget the
          // observability call. The redirect itself is what
          // matters for the student; the log line is best-
          // effort. See block comment above for rationale.
          void reportInfo({
            source: "proxy.onboarding-gate",
            message: "Student gated — redirected to /onboarding/[id]",
            context: {
              event: "redirected",
              userId,
              pathname,
              onboardingId: gate.onboardingId,
              rowStatus: gate.rowStatus,
            },
          }).catch(() => null);
          const redirect = new URL(`/onboarding/${gate.onboardingId}`, req.url);
          return NextResponse.redirect(redirect);
        }
      } catch (err) {
        // Never 500 the student on a gate-side bug; log and fall
        // through to allow. Defensive: a Convex outage should not
        // brick navigation.
        // Fire-and-forget: see Greptile P2 note in the gate's
        // block comment above.
        void reportError({
          source: "proxy.onboarding-gate",
          error: err instanceof Error ? err : new Error(String(err)),
          message: "Onboarding gate check threw; falling through to allow",
          level: "warn",
          context: { userId, pathname },
        }).catch(() => null);
      }
    }
  }

  return NextResponse.next();
}

// If Clerk is not configured, use a simple middleware that allows all routes
// Otherwise, use clerkMiddleware
export default hasClerkKey
  ? clerkMiddleware(middlewareHandler)
  : async function fallbackMiddleware(req: NextRequest) {
      /**
       * Fallback request handler used when Clerk is not configured.
       * Still applies rate limiting and CSRF validation where possible.
       */
      const pathname = req.nextUrl.pathname;
      const method = req.method;

      // Even if Clerk isn't configured, still apply rate limiting to /api/*.
      // This avoids disabling platform-wide rate limiting/security when auth is misconfigured.
      if (
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/inngest") &&
        pathname !== "/api/health"
      ) {
    const { policy, requested }: { policy: RateLimitPolicy; requested: number } = (() => {
          if (pathname.startsWith("/api/webhooks/")) {
            return { policy: "webhook", requested: 1 };
          }

          if (pathname === "/api/contacts" || pathname === "/api/waitlist") {
            return { policy: "forms", requested: 1 };
          }

          if (
            pathname.startsWith("/api/seats/availability/") ||
            (pathname.startsWith("/api/instructors/") && pathname.endsWith("/availability"))
          ) {
            return { policy: "availability", requested: 1 };
          }

          if (pathname.startsWith("/api/auth/")) {
            return { policy: "auth", requested: 1 };
          }

          if (pathname.startsWith("/api/checkout/")) {
            return { policy: "default", requested: 1 };
          }

          if (pathname === "/api/sessions" && method === "POST") {
            return { policy: "default", requested: 1 };
          }

          if (pathname.startsWith("/api/instructor/")) {
            return { policy: "default", requested: 1 };
          }

          return { policy: "default", requested: 1 };
        })();

        const rateLimitResponse = await protectWithRateLimit(req, {
          policy,
          userId: null,
          requested,
        });
        if (rateLimitResponse) {
          return rateLimitResponse;
        }
      }

      // CSRF Protection (mirrors the Clerk-enabled path)
      if (requiresCSRFValidation(req, isPublicApiRoute(req))) {
        const csrfError = await validateCSRFOrigin(req);
        if (csrfError) {
          return csrfError;
        }
      }

      // In production, failing open on auth configuration is dangerous. Fail loudly.
      if (process.env.NODE_ENV === "production") {
        if (req.nextUrl.pathname.startsWith("/api/") && !isPublicApiRoute(req)) {
          return NextResponse.json({ error: "Authentication not configured" }, { status: 503 });
        }

        if (isProtectedRoute(req)) {
          return NextResponse.json({ error: "Authentication not configured" }, { status: 503 });
        }
      }

      // When Clerk is not configured, allow all routes (useful for local dev / static previews)
      return NextResponse.next();
    };

/**
 * Configure which routes the middleware should run on
 * This improves performance by skipping unnecessary middleware execution
 */
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
