import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
]);

export default clerkMiddleware(async (auth, request): Promise<void> => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
}, {
  isSatellite: process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true",
  signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in",
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};