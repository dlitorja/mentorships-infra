import { clerkMiddleware, createRouteMatcher, type ClerkMiddlewareAuth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { protectWithArcjet, type ArcjetPolicy } from "@/lib/arcjet";
import { reportError } from "@/lib/observability";

/**
 * Allowed origins for CSRF protection
 * Validates Origin header on state-changing requests
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  
  // Primary app URL
  if (process.env.NEXT_PUBLIC_URL) {
    origins.push(process.env.NEXT_PUBLIC_URL);
  }
  
  // Vercel deployment URLs
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }
  
  // Additional allowed origins from environment
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(...process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()));
  }
  
  // Local development
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  
  return origins;
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
    // Allow requests without Origin header if they have a Referer from same site
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (allowedOrigins.includes(refererOrigin)) {
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
  if (!allowedOrigins.includes(origin)) {
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
  "/sessions(.*)",
  "/calendar(.*)",
  "/settings(.*)",
  "/api/checkout(.*)",
  "/api/sessions(.*)",
  "/api/orders(.*)",
  "/api/payments(.*)",
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
  "/test(.*)", // Test page for verification
]);

// Check if Clerk is configured
const hasClerkKey = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder_for_build_time_only" &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_")
);

// Create middleware function that handles both cases
async function middlewareHandler(auth: ClerkMiddlewareAuth, req: NextRequest) {
  const { userId } = await auth();

  const pathname = req.nextUrl.pathname;
  const method = req.method;

  // Apply Arcjet protection to API routes (method-aware policy matrix)
  // Note: We intentionally skip /api/inngest (dev server) and /api/health (monitoring).
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/inngest") &&
    pathname !== "/api/health"
  ) {
    const { policy, requested }: { policy: ArcjetPolicy; requested: number } = (() => {
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
        (pathname.startsWith("/api/mentors/") && pathname.endsWith("/availability"))
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

    const arcjetResponse = await protectWithArcjet(req, { policy, userId, requested });
    if (arcjetResponse) {
      return arcjetResponse;
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
  }

  return NextResponse.next();
}

// If Clerk is not configured, use a simple middleware that allows all routes
// Otherwise, use clerkMiddleware
export default hasClerkKey
  ? clerkMiddleware(middlewareHandler)
  : async function middleware(req: NextRequest) {
      const pathname = req.nextUrl.pathname;
      const method = req.method;

      // Even if Clerk isn't configured, still apply Arcjet to /api/*.
      // This avoids disabling platform-wide rate limiting/security when auth is misconfigured.
      if (
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/inngest") &&
        pathname !== "/api/health"
      ) {
        const { policy, requested }: { policy: ArcjetPolicy; requested: number } = (() => {
          if (pathname.startsWith("/api/webhooks/")) {
            return { policy: "webhook", requested: 1 };
          }

          if (pathname === "/api/contacts" || pathname === "/api/waitlist") {
            return { policy: "forms", requested: 1 };
          }

          if (
            pathname.startsWith("/api/seats/availability/") ||
            (pathname.startsWith("/api/mentors/") && pathname.endsWith("/availability"))
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

        const arcjetResponse = await protectWithArcjet(req, {
          policy,
          userId: null,
          requested,
        });
        if (arcjetResponse) {
          return arcjetResponse;
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

