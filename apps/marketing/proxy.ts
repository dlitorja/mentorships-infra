import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyWebhookSignature } from "@/lib/webhook-utils";
import { protectWithRateLimit, type RateLimitPolicy } from "@/lib/ratelimit";

const isPublicRoute = createRouteMatcher([
  "/",
  "/admin/signin(.*)",
  "/admin/signup(.*)",
  "/api/webhooks(.*)",
  "/api/contacts(.*)",
  "/api/waitlist(.*)",
  "/api/free-mentorship(.*)",
  "/api/instructor/inventory(.*)",
  "/api/inngest(.*)",
  "/instructors(.*)",
  "/free-mentorship(.*)",
  "/waitlist(.*)",
]);

const isWebhookRoute = createRouteMatcher([
  "/api/webhooks(.*)",
]);

async function verifyClerkWebhook(req: NextRequest): Promise<boolean> {
  const clonedReq = req.clone();
  const payload = await clonedReq.text();
  const signature = req.headers.get("svix-signature");

  if (!signature) {
    return false;
  }

  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }

  return verifyWebhookSignature(secret, payload, signature);
}

async function verifyStripeWebhook(req: NextRequest): Promise<boolean> {
  const clonedReq = req.clone();
  const payload = await clonedReq.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return false;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }

  return verifyWebhookSignature(secret, payload, signature);
}

export default clerkMiddleware(async (auth, request): Promise<NextResponse | undefined> => {
  const pathname = request.nextUrl.pathname;

  if (isWebhookRoute(request)) {
    const rateLimitResponse = await protectWithRateLimit(request, "webhook");
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    if (pathname.startsWith("/api/webhooks/clerk")) {
      const isValid = await verifyClerkWebhook(request);
      if (!isValid) {
        return new NextResponse("Invalid Clerk webhook signature", { status: 401 });
      }
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/webhooks/stripe")) {
      const isValid = await verifyStripeWebhook(request);
      if (!isValid) {
        return new NextResponse("Invalid Stripe webhook signature", { status: 401 });
      }
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/webhooks/kajabi")) {
      return NextResponse.next();
    }

    return new NextResponse("Webhook type not recognized", { status: 400 });
  }

  if (pathname.startsWith("/api/admin")) {
    const rateLimitResponse = await protectWithRateLimit(request, "admin");
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  if (
    pathname.startsWith("/api/contacts") ||
    pathname.startsWith("/api/waitlist") ||
    pathname.startsWith("/api/free-mentorship") ||
    pathname.startsWith("/api/instructor/inventory") ||
    pathname.startsWith("/api/inngest")
  ) {
    const rateLimitResponse = await protectWithRateLimit(request, "default");
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  await auth.protect();
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
