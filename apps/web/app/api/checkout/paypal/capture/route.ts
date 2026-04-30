import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { capturePayPalOrder, getPayPalOrder } from "@mentorships/payments";
import { inngest } from "@/inngest/client";

const captureSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
});

/**
 * Capture a PayPal order after customer approval
 * This endpoint is called after the user returns from PayPal approval
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(); // User must be authenticated
    const body = await req.json();
    
    // Validate request body
    const validationResult = captureSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }
    
    const { orderId } = validationResult.data;

    // Capture the PayPal order
    const capturedOrder = await capturePayPalOrder(orderId);

    console.log(`PayPal order captured: ${capturedOrder.id}, status: ${capturedOrder.status}`);

    // Safety net: Send Inngest event immediately for fulfillment
    // This ensures fulfillment even if webhook delivery is delayed
    // The webhook also sends this event, but both paths are idempotent
    try {
      // Fetch order details to get custom_id (contains orderId and packId)
      const paypalOrderDetails = await getPayPalOrder(orderId);
      const purchaseUnits = paypalOrderDetails.purchaseUnits;
      
      if (purchaseUnits && purchaseUnits.length > 0) {
        const customId = purchaseUnits[0].customId;
        if (typeof customId === "string") {
          try {
            const decoded = JSON.parse(customId);
            const dbOrderId = decoded.orderId;
            const packId = decoded.packId;
            
            if (dbOrderId && packId) {
              // Send Inngest event for fulfillment
              await inngest.send({
                name: "paypal/payment.capture.completed",
                data: {
                  captureId: capturedOrder.id,
                  orderId: dbOrderId,
                  packId: packId,
                },
              });
              console.log(`Inngest event sent for order ${dbOrderId}, pack ${packId}`);
            }
          } catch {
            // customId is not JSON, skip Inngest event
            console.log(`Could not parse customId for Inngest event: ${customId}`);
          }
        }
      }
    } catch (inngestError) {
      // Don't fail the capture if Inngest send fails
      // The webhook will still handle fulfillment
      console.error(`Inngest event send failed (webhook will handle):`, inngestError);
    }

    return NextResponse.json({ 
      success: true,
      orderId: capturedOrder.id,
      status: capturedOrder.status,
    });
  } catch (error) {
    console.error("PayPal capture error:", error);
    return NextResponse.json(
      { error: "Capture failed" },
      { status: 500 }
    );
  }
}

