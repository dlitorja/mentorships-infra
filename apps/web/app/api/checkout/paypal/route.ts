import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  getProductById,
  updateOrderStatus,
  createOrder,
} from "@mentorships/db";
import { createPayPalOrder } from "@mentorships/payments";

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
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }
    
    const { packId } = validationResult.data;

    // Get pack details from database
    const pack = await getProductById(packId);

    if (!pack) {
      return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    }

    // Note: PayPal doesn't require a product ID like Stripe
    // We'll create the order directly with the amount

    // Create order in database (status: pending)
    const order = await createOrder(
      userId,
      "paypal",
      pack.price,
      "usd"
    );

    orderId = order.id;

    // Determine base URL - only use environment variables for security
    let baseUrl: string;
    if (process.env.NEXT_PUBLIC_URL) {
      baseUrl = process.env.NEXT_PUBLIC_URL;
    } else if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else {
      // Development fallback - throw error in production
      if (process.env.NODE_ENV === "production") {
        throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
      }
      baseUrl = "http://localhost:3000";
    }

    // Create PayPal order with error handling
    // Store packId in custom_id along with orderId (PayPal doesn't support metadata like Stripe)
    // We'll encode it as JSON: { orderId, packId }
    let paypalOrder;
    try {
      paypalOrder = await createPayPalOrder(
        pack.price,
        "usd",
        {
          userId,
          mentorId: pack.mentorId,
          productId: packId,
          orderId: JSON.stringify({ orderId: order.id, packId }), // Encode packId in custom_id
        },
        `${baseUrl}/checkout/success?order_id={ORDER_ID}`,
        `${baseUrl}/checkout/cancel`
      );
    } catch (paypalError) {
      // Mark order as failed if PayPal order creation fails
      if (orderId) {
        try {
          await updateOrderStatus(orderId, "failed");
        } catch (updateError) {
          console.error(`Failed to update order ${orderId} to failed:`, updateError);
        }
      }
      throw paypalError;
    }

    // Return approval URL (PayPal redirects user here to approve payment)
    return NextResponse.json({ url: paypalOrder.approvalUrl, orderId: paypalOrder.orderId });
  } catch (error) {
    console.error("PayPal checkout error:", error);

    // Cleanup: Mark order as failed if still pending (idempotent)
    if (orderId) {
      try {
        await updateOrderStatus(orderId, "failed");
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

