import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk(.*)",
]);

export default clerkMiddleware(
  { domain: process.env.NEXT_PUBLIC_CLERK_DOMAIN },
  async (auth, request) => {
    if (!isPublicRoute(request)) {
      await auth.protect();
    }
  }
);

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};