import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { createPayPalOrder } from "@mentorships/payments";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const checkoutSchema = z.object({
  packId: z.string().min(1, "packId is required"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let orderId: string | null = null;

  try {
    const userId = await requireAuth();
    const body = await req.json();

    const validationResult = checkoutSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { packId } = validationResult.data;
    const convex = getConvexClient();

    const pack = await convex.query(api.products.getProductById, {
      id: packId as Id<"products">,
    });

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    const order = await convex.mutation(api.orders.createOrder, {
      userId,
      status: "pending",
      provider: "paypal",
      totalAmount: pack.price,
      currency: "usd",
    });

    orderId = order as string;

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

    let paypalOrder;
    try {
      paypalOrder = await createPayPalOrder(
        pack.price,
        "usd",
        {
          userId,
          mentorId: pack.mentorId || "",
          productId: packId,
          orderId: JSON.stringify({ orderId: orderId, packId }),
        },
        `${baseUrl}/checkout/success?order_id={ORDER_ID}`,
        `${baseUrl}/checkout/cancel`
      );
    } catch (paypalError) {
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
      throw paypalError;
    }

    return NextResponse.json({ url: paypalOrder.approvalUrl, orderId: paypalOrder.orderId });
  } catch (error) {
    console.error("PayPal checkout error:", error);

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

