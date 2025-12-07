import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/packages/db/src/lib/clerk";
import { db } from "@/packages/db";
import { orders } from "@/packages/db/src/schema";
import { getProductById } from "@/packages/db/src/lib/queries/products";
import { cancelOrder, updateOrderStatus } from "@/packages/db/src/lib/queries/orders";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

const checkoutSchema = z.object({
  packId: z.string().min(1, "packId is required"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let orderId: string | null = null;

  try {
    const userId = await requireAuth();
    const body = await req.json();
    
    // Validate request body
    const validationResult = checkoutSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const { packId } = validationResult.data;

    // Get pack details from database
    const pack = await getProductById(packId);

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    if (!pack.stripePriceId) {
      return NextResponse.json(
        { error: "Stripe price ID not configured for this pack" },
        { status: 400 }
      );
    }

    // Create order in database (status: pending)
    const [order] = await db
      .insert(orders)
      .values({
        userId,
        status: "pending",
        provider: "stripe",
        totalAmount: pack.price,
        currency: "usd",
      })
      .returning();

    orderId = order.id;

    // Determine base URL
    let baseUrl: string;
    if (process.env.NEXT_PUBLIC_URL) {
      baseUrl = process.env.NEXT_PUBLIC_URL;
    } else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      const origin = req.headers.get("origin");
      if (origin) {
        baseUrl = origin;
      } else {
        const host = req.headers.get("host") || "localhost:3000";
        baseUrl = `http://${host}`;
      }
    }

    // Create Stripe Checkout Session with error handling
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment", // One-time payment (NOT subscription!)
        line_items: [
          {
            price: pack.stripePriceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout/cancel`,
        metadata: {
          order_id: order.id, // Critical: Link to your order
          user_id: userId,
          pack_id: packId,
        },
      });
    } catch (stripeError) {
      // Mark order as failed if Stripe session creation fails
      if (orderId) {
        try {
          await updateOrderStatus(orderId, "failed");
        } catch (updateError) {
          console.error(`Failed to update order ${orderId} to failed:`, updateError);
        }
      }
      throw stripeError;
    }

    // Return checkout URL
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);

    // Cleanup: Mark order as failed if still pending
    if (orderId) {
      try {
        const order = await db
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        
        if (order[0] && order[0].status === "pending") {
          await updateOrderStatus(orderId, "failed");
          console.log(`Marked orphaned order ${orderId} as failed`);
        }
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

