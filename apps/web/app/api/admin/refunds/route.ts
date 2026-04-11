import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  payments,
  orders,
  users,
  eq,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { stripe } from "@/lib/stripe";
import { createRefund as createPayPalRefund } from "@mentorships/payments/paypal/refunds";
import { buildRefundEmail } from "@/lib/emails/refund-email";
import { sendEmail } from "@/lib/email";
import { requireRoleForApi } from "@/lib/auth-helpers";

const refundReasons = [
  "Duplicate",
  "Fraudulent",
  "Requested by customer",
  "Other",
] as const;

const createRefundSchema = z.object({
  paymentId: z.string().uuid("Invalid payment ID format"),
  refundType: z.enum(["full", "partial"]),
  amount: z.string().optional(), // Required if partial
  reason: z.enum(refundReasons),
  customReason: z.string().max(500).optional(),
});

type RefundInput = z.infer<typeof createRefundSchema>;

/**
 * POST /api/admin/refunds
 * Process a refund for a payment
 * 
 * Allows full or partial refunds for both Stripe and PayPal payments.
 * Sends refund notification email to the student.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const body = await req.json();
    const validationResult = createRefundSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const {
      paymentId,
      refundType,
      amount,
      reason,
      customReason,
    } = validationResult.data as RefundInput;

    // Get payment details
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      );
    }

    // Check if already refunded
    if (payment.status === "refunded") {
      return NextResponse.json(
        { error: "Payment has already been refunded" },
        { status: 400 }
      );
    }

    // Check if payment failed
    if (payment.status === "failed") {
      return NextResponse.json(
        { error: "Cannot refund a failed payment" },
        { status: 400 }
      );
    }

    // Calculate refund amount
    const originalAmount = parseFloat(payment.amount);
    let refundAmount: number;

    if (refundType === "partial") {
      if (!amount) {
        return NextResponse.json(
          { error: "Amount is required for partial refunds" },
          { status: 400 }
        );
      }
      refundAmount = parseFloat(amount);

      // Get previously refunded amount
      const previouslyRefunded = payment.refundedAmount
        ? parseFloat(payment.refundedAmount)
        : 0;

      const remainingRefundable = originalAmount - previouslyRefunded;

      if (refundAmount > remainingRefundable) {
        return NextResponse.json(
          {
            error: `Refund amount exceeds remaining refundable amount (${remainingRefundable.toFixed(2)})`,
          },
          { status: 400 }
        );
      }
    } else {
      // Full refund - use remaining amount
      const previouslyRefunded = payment.refundedAmount
        ? parseFloat(payment.refundedAmount)
        : 0;
      refundAmount = originalAmount - previouslyRefunded;
    }

    if (refundAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid refund amount" },
        { status: 400 }
      );
    }

    const refundAmountStr = refundAmount.toFixed(2);
    const currency = payment.currency || "usd";

    // Process refund based on provider
    let providerRefundId: string | null = null;

    if (payment.provider === "stripe") {
      try {
        // Stripe refund - payment.providerPaymentId is the charge/payment intent
        const refund = await stripe.refunds.create({
          payment_intent: payment.providerPaymentId,
          amount: Math.round(refundAmount * 100), // Convert to cents
          reason: reason === "Fraudulent"
            ? "fraudulent"
            : reason === "Duplicate"
            ? "duplicate"
            : "requested_by_customer",
        });
        providerRefundId = refund.id;
      } catch (stripeError) {
        console.error("Stripe refund failed:", stripeError);
        return NextResponse.json(
          { error: "Failed to process Stripe refund" },
          { status: 500 }
        );
      }
    } else {
      // PayPal refund
      try {
        // providerPaymentId should be the capture ID for PayPal
        const refund = await createPayPalRefund(
          payment.providerPaymentId,
          refundAmountStr,
          currency.toUpperCase()
        );
        providerRefundId = refund.id || null;
      } catch (paypalError) {
        console.error("PayPal refund failed:", paypalError);
        return NextResponse.json(
          { error: "Failed to process PayPal refund" },
          { status: 500 }
        );
      }
    }

    // Update payment status
    const newRefundedAmount = (
      (parseFloat(payment.refundedAmount || "0") + refundAmount)
    ).toFixed(2);

    const newStatus =
      parseFloat(newRefundedAmount) >= originalAmount ? "refunded" : "completed";

    await db
      .update(payments)
      .set({
        status: newStatus,
        refundedAmount: newRefundedAmount,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    // Update order status
    await db
      .update(orders)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, payment.orderId));

    // Send refund email to student
    try {
      // Get user details
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .limit(1);

      if (order) {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, order.userId))
          .limit(1);

        if (user?.email) {
          // Default instructor name - in production this should be looked up via session pack
          const instructorName = "Your Instructor";

          const refundEmail = buildRefundEmail({
            studentName: user.firstName,
            instructorName,
            refundAmount: refundAmountStr,
            currency,
            reason,
            customReason: customReason || null,
            dashboardUrl: process.env.NEXT_PUBLIC_URL
              ? `${process.env.NEXT_PUBLIC_URL}/dashboard`
              : "https://huckleberry.art/dashboard",
            provider: payment.provider,
            providerReference: providerRefundId,
          });

          await sendEmail({
            to: user.email,
            subject: refundEmail.subject,
            html: refundEmail.html,
            text: refundEmail.text,
            headers: refundEmail.headers,
          });
        }
      }
    } catch (emailError) {
      // Don't fail the refund if email fails - just log it
      console.error("Failed to send refund email:", emailError);
    }

    return NextResponse.json({
      success: true,
      message: "Refund processed successfully",
      refund: {
        paymentId,
        amount: refundAmountStr,
        currency,
        type: refundType,
        reason,
        customReason: customReason || null,
        providerRefundId,
        provider: payment.provider,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error processing refund:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process refund" },
      { status: 500 }
    );
  }
}