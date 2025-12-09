import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@mentorships/db";
import { capturePayPalOrder } from "@mentorships/payments";

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
        { error: "Invalid request", details: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const { orderId } = validationResult.data;

    // Capture the PayPal order
    const capturedOrder = await capturePayPalOrder(orderId);

    console.log(`PayPal order captured: ${capturedOrder.id}, status: ${capturedOrder.status}`);

    // The webhook will handle the rest (creating payment, pack, seat)
    // But we return success so the frontend knows the capture succeeded
    
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

