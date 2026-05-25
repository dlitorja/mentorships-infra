import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { stripe } from "@/lib/stripe";
import crypto from "node:crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const checkoutSchema = z.object({
  packId: z.string().min(1, "packId is required"),
  email: z.string().email().optional(),
  fullName: z.string().optional(),
  promotionCode: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let orderId: string | null = null;

  try {
    const rawBody = await req.json();
    // Minimal compatibility: accept either `packId` or `productId`
    const body =
      typeof rawBody === "object" && rawBody !== null
        ? {
            packId: rawBody.packId ?? rawBody.productId,
            email: rawBody.email,
            fullName: rawBody.fullName,
            promotionCode: rawBody.promotionCode,
          }
        : rawBody;

    const validationResult = checkoutSchema.safeParse(body as unknown);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { packId, promotionCode, email, fullName } = validationResult.data;
    const convex = getConvexClient();

    // Use public product lookup to support guest checkout
    const pack = await convex.query(api.products.getPublicProductById, {
      id: packId as Id<"products">,
    });

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    if (!pack.stripePriceId) {
      return NextResponse.json(
        { error: "Stripe price ID not configured for this pack" },
        { status: 400 }
      );
    }

    let finalPrice = pack.price;

    // Resolve user: if authenticated, use that userId; otherwise upsert by email
    const { userId: authedUserId } = await auth();
    let userIdForOrder: string | null = authedUserId ?? null;
    let customerEmail: string | undefined = undefined;

    let createdNewUser = false;
    if (!userIdForOrder) {
      if (!email || !fullName) {
        return NextResponse.json(
          { error: "Email and full name are required" },
          { status: 400 }
        );
      }
      const client = await clerkClient();
      // Try to find existing user by email
      const { data } = await client.users.getUserList({ emailAddress: [email] } as any);
      if (data.length > 0) {
        userIdForOrder = data[0].id;
      } else {
        const [firstName, ...rest] = fullName.trim().split(" ");
        const lastName = rest.join(" ");
        const created = await client.users.createUser({
          emailAddress: [email],
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          // Mark as a student in public metadata if used by the app
          publicMetadata: { role: "student" },
        } as any);
        userIdForOrder = created.id;
        createdNewUser = true;
      }
      customerEmail = email;
    }

    const order = await convex.mutation(api.orders.createOrder, {
      userId: userIdForOrder!,
      status: "pending",
      provider: "stripe",
      totalAmount: finalPrice,
      currency: "usd",
    });

    if (!order) {
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    orderId = order._id;

    let baseUrl: string;
    if (process.env.NEXT_PUBLIC_URL) {
      baseUrl = process.env.NEXT_PUBLIC_URL;
    } else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
      }
      baseUrl = "http://localhost:3000";
    }

    const discounts: Array<{ coupon?: string; promotion_code?: string }> = [];

    if (promotionCode) {
      discounts.push({ promotion_code: promotionCode });
    }

    let session: Stripe.Checkout.Session;
    try {
      const ts = Date.now().toString();
      const secret = process.env.CANCEL_TOKEN_SECRET;
      const base = `${orderId}:${ts}`;
      const token = secret ? crypto.createHmac("sha256", secret).update(base).digest("hex") : undefined;
      const cancelUrl = token
        ? `${baseUrl}/api/checkout/cancel?order_id=${encodeURIComponent(orderId!)}&ts=${encodeURIComponent(ts)}&token=${encodeURIComponent(token)}`
        : `${baseUrl}/checkout/cancel`;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        line_items: [
          {
            price: pack.stripePriceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}${createdNewUser ? "&new=1" : ""}`,
        cancel_url: cancelUrl,
        metadata: {
          order_id: orderId!,
          user_id: userIdForOrder!,
          pack_id: packId,
        },
        allow_promotion_codes: discounts.length === 0,
      };

      if (discounts.length > 0) {
        sessionParams.discounts = discounts;
      }

      if (customerEmail) {
        sessionParams.customer_email = customerEmail;
      }

      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeError) {
      if (orderId) {
        try {
          await convex.mutation(api.orders.updateOrder, {
            id: orderId as Id<"orders">,
            status: "failed",
          });
        } catch (updateError) {
          console.error(`Failed to update order ${orderId} to failed:`, updateError);
        }
      }
      throw stripeError;
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);

    if (orderId) {
      try {
        const convex = getConvexClient();
        await convex.mutation(api.orders.updateOrder, {
          id: orderId as Id<"orders">,
          status: "failed",
        });
        console.log(`Marked orphaned order ${orderId} as failed`);
      } catch (cleanupError) {
        console.error(`Failed to cleanup order ${orderId}:`, cleanupError);
      }
    }

    return NextResponse.json(
      { error: "Checkout failed" },
      { status: 500 }
    );
  }
}
