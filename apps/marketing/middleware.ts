import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyWebhookSignature } from "@/lib/webhook-utils";

function isPublicRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/admin/signin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/webhooks/kajabi")
  );
}

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

  if (pathname.startsWith("/api/webhooks")) {
    return new NextResponse("Webhook type not recognized", { status: 400 });
  }

  if (isPublicRoute(pathname)) {
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
