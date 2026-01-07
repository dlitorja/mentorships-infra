import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isPublicRoute(pathname: string): boolean {
  return pathname.startsWith("/admin/signin");
}

async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const expectedSignature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );
    
    const expectedBytes = new Uint8Array(expectedSignature);
    const signatureBytes = encoder.encode(signature);
    
    if (signatureBytes.length !== expectedBytes.length) {
      return false;
    }
    
    for (let i = 0; i < expectedBytes.length; i++) {
      if (expectedBytes[i] !== signatureBytes[i]) {
        return false;
      }
    }
    
    return true;
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

  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }

  return verifyWebhookSignature(secret, payload, signature);
}

async function verifyStripeWebhook(req: NextRequest): Promise<boolean> {
  const payload = await req.text();
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
