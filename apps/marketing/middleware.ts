import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

function isPublicRoute(pathname: string): boolean {
  return pathname.startsWith("/admin/signin");
}

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function verifyWebhookSignature(
  req: NextRequest,
  secret: string | undefined,
  signatureHeader: string,
  payload: string
): boolean {
  if (!secret) {
    console.error("Webhook secret not configured");
    return false;
  }

  const signature = req.headers.get(signatureHeader);
  if (!signature) {
    console.error("Missing webhook signature header");
    return false;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const encoder = new TextEncoder();
  const expectedBuffer = encoder.encode(expectedSignature);
  const signatureBuffer = encoder.encode(signature);

  try {
    return timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

async function verifyClerkWebhook(req: NextRequest): Promise<boolean> {
  const payload = await req.text();
  const signature = req.headers.get("svix-signature");
  
  if (!signature) {
    return false;
  }

  if (!CLERK_WEBHOOK_SECRET) {
    console.error("CLERK_WEBHOOK_SECRET not configured");
    return false;
  }

  return verifyWebhookSignature(req, CLERK_WEBHOOK_SECRET, "svix-signature", payload);
}

async function verifyStripeWebhook(req: NextRequest): Promise<boolean> {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  
  if (!signature) {
    return false;
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return false;
  }

  return verifyWebhookSignature(req, STRIPE_WEBHOOK_SECRET, "stripe-signature", payload);
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
