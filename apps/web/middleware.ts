import { clerkMiddleware, createRouteMatcher, type ClerkMiddlewareAuth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { protectWithArcjet, type ArcjetPolicy } from "@/lib/arcjet";

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
      // When Clerk is not configured, allow all routes
      // This allows the app to work even without Clerk setup
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

