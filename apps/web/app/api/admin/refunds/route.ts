import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { stripe } from "@/lib/stripe";
import { createPayPalRefund } from "@mentorships/payments";
import { buildRefundEmail } from "@/lib/emails/refund-email";
import { sendEmail } from "@/lib/email";

const refundReasons = [
  "Duplicate",
  "Fraudulent",
  "Requested by customer",
  "Other",
] as const;

const createRefundSchema = z.object({
  paymentId: z.string(),
  refundType: z.enum(["full", "partial"]),
  amount: z.string().optional(),
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

    const convex = getConvexClient();

    const payment = await convex.query(api.payments.getPaymentById, {
      id: paymentId as Id<"payments">,
    });

    if (!payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      );
    }

    if (payment.status === "refunded") {
      return NextResponse.json(
        { error: "Payment has already been refunded" },
        { status: 400 }
      );
    }

    if (payment.status === "failed") {
      return NextResponse.json(
        { error: "Cannot refund a failed payment" },
        { status: 400 }
      );
    }

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

    let providerRefundId: string | null = null;

    if (payment.provider === "stripe") {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: payment.providerPaymentId,
          amount: Math.round(refundAmount * 100),
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
      try {
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

    await convex.mutation(api.payments.adminProcessRefund, {
      paymentId: paymentId as Id<"payments">,
      refundAmount: refundAmountStr,
    });

    try {
      const order = await convex.query(api.orders.getOrderById, {
        id: payment.orderId as Id<"orders">,
      });

      if (order) {
        const user = await convex.query(api.users.getUserByUserId, {
          userId: order.userId,
        });

        if (user?.email) {
          const instructorName = "Your Instructor";

          const refundEmail = buildRefundEmail({
            studentName: user.email,
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