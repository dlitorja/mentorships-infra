import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
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
async function middlewareHandler(auth: any, req: NextRequest) {
  const { userId, sessionId } = await auth();

  const pathname = req.nextUrl.pathname;

  // Apply Arcjet protection to API routes (except explicitly public ones)
  if (pathname.startsWith("/api/") && !isPublicApiRoute(req)) {
    const policy: ArcjetPolicy = (() => {
      if (pathname.startsWith("/api/checkout/")) return userId ? "checkout" : "default";
      if (pathname.startsWith("/api/auth/")) return "auth";

      // Booking + availability endpoints tend to be hit frequently; keep a dedicated bucket
      if (
        pathname === "/api/sessions" ||
        pathname.startsWith("/api/sessions/") ||
        pathname.includes("/api/mentors/") && pathname.endsWith("/availability") ||
        pathname.startsWith("/api/seats/availability/")
      ) {
        return userId ? "booking" : "default";
      }

      // Default: use per-user buckets when authenticated, otherwise per-IP
      return userId ? "user" : "default";
    })();

    const arcjetResponse = await protectWithArcjet(req, { policy, userId, requested: 1 });
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

