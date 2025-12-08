import { inngest } from "../client";
import {
  db,
  orders,
  payments,
  sessionPacks,
  seatReservations,
  mentorshipProducts,
  getOrderById,
  getPaymentByProviderId,
  getSessionPackByPaymentId,
  releaseSeatByPackId,
  updatePaymentStatus,
  updateOrderStatus,
  updateSessionPackStatus,
  getProductById,
} from "@mentorships/db";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

// Process Stripe checkout completion
export const processStripeCheckout = inngest.createFunction(
  {
    id: "process-stripe-checkout",
    name: "Process Stripe Checkout",
    retries: 3,
  },
  { event: "stripe/checkout.session.completed" },
  async ({ event, step }) => {
    const { sessionId, orderId, userId, packId } = event.data;

    // Step 1: Get order with retry (handle race conditions)
    const order = await step.run("get-order", async () => {
      // Retry logic for race condition if webhook fires before order creation
      let attempts = 0;
      let foundOrder = null;
      while (attempts < 3 && !foundOrder) {
        foundOrder = await getOrderById(orderId);
        if (!foundOrder) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempts + 1)));
          attempts++;
        }
      }
      if (!foundOrder) {
        throw new Error(`Order ${orderId} not found after retries`);
      }
      return foundOrder;
    });

    // Step 2: Check idempotency (prevent duplicate processing)
    if (order.status === "paid") {
      return { message: "Order already processed", orderId, alreadyProcessed: true };
    }

    // Step 3: Retrieve full Stripe session with discount details
    const fullSession = await step.run("get-stripe-session", async () => {
      return await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["total_details.breakdown.discounts"],
      });
    });

    // Step 4: Extract discount information
    const discountAmount = fullSession.total_details?.amount_discount
      ? (fullSession.total_details.amount_discount / 100).toString()
      : null;
    const originalAmount = fullSession.amount_subtotal
      ? (fullSession.amount_subtotal / 100).toString()
      : null;

    // Get discount code/coupon
    let discountCode: string | null = null;
    if (
      fullSession.total_details?.breakdown?.discounts &&
      fullSession.total_details.breakdown.discounts.length > 0
    ) {
      const discount = fullSession.total_details.breakdown.discounts[0];
      if (discount.discount?.promotion_code) {
        discountCode =
          discount.discount.promotion_code.code ||
          discount.discount.promotion_code.id ||
          null;
      } else if (discount.discount?.coupon) {
        discountCode =
          discount.discount.coupon.id || discount.discount.coupon.name || null;
      }
    }

    // Step 5: Update order (idempotency handled by checking order status earlier)
    await step.run("update-order", async () => {
      // Build update object - only include discount fields if they have values
      const updateData: {
        status: "paid";
        totalAmount: string;
        updatedAt: Date;
        originalAmount?: string;
        discountAmount?: string | null;
        discountCode?: string | null;
      } = {
        status: "paid",
        totalAmount: (fullSession.amount_total! / 100).toString(),
        updatedAt: new Date(),
      };

      // Only include discount fields if they have values
      if (originalAmount) {
        updateData.originalAmount = originalAmount || order.totalAmount;
      }
      if (discountAmount) {
        updateData.discountAmount = discountAmount;
      }
      if (discountCode) {
        updateData.discountCode = discountCode;
      }

      await db
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, orderId));
    });

    // Step 6: Create payment record (check for existing payment first for idempotency)
    const payment = await step.run("create-payment", async () => {
      // Check if payment already exists (idempotency)
      const existingPayment = await getPaymentByProviderId(
        "stripe",
        fullSession.payment_intent as string
      );
      if (existingPayment) {
        return existingPayment;
      }

      const [payment] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "stripe",
          providerPaymentId: fullSession.payment_intent as string,
          amount: (fullSession.amount_total! / 100).toString(),
          currency: fullSession.currency!,
          status: "completed",
        })
        .returning();
      return payment;
    });

    // Step 7: Get product info
    const product = await step.run("get-product", async () => {
      const productData = await getProductById(packId);

      if (!productData) {
        throw new Error(`Product not found: ${packId}`);
      }
      return productData;
    });

    // Step 8: Create session pack
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + product.validityDays);

    const sessionPack = await step.run("create-session-pack", async () => {
      // Check if pack already exists for this payment (idempotency)
      const existingPack = await getSessionPackByPaymentId(payment.id);
      if (existingPack) {
        return existingPack;
      }

      const [pack] = await db
        .insert(sessionPacks)
        .values({
          userId,
          mentorId: product.mentorId,
          totalSessions: product.sessionsPerPack,
          remainingSessions: product.sessionsPerPack,
          expiresAt,
          status: "active",
          paymentId: payment.id,
        })
        .returning();
      return pack;
    });

    // Step 9: Create seat reservation (check for existing reservation first)
    await step.run("create-seat-reservation", async () => {
      // Check if reservation already exists (idempotency)
      const existingReservation = await db
        .select()
        .from(seatReservations)
        .where(eq(seatReservations.sessionPackId, sessionPack.id))
        .limit(1);

      if (existingReservation.length > 0) {
        return; // Already exists
      }

      await db.insert(seatReservations).values({
        mentorId: product.mentorId,
        userId,
        sessionPackId: sessionPack.id,
        seatExpiresAt: expiresAt,
        status: "active",
      });
    });

    // Step 10: Send purchase/mentorship event for onboarding
    await step.run("trigger-onboarding", async () => {
      await inngest.send({
        name: "purchase/mentorship",
        data: {
          orderId: order.id,
          clerkId: userId, // Clerk user ID
          packId: product.id,
          provider: "stripe",
        },
      });
    });

    return {
      success: true,
      orderId,
      sessionPackId: sessionPack.id,
      paymentId: payment.id,
    };
  }
);

// Process Stripe refund
export const processStripeRefund = inngest.createFunction(
  {
    id: "process-stripe-refund",
    name: "Process Stripe Refund",
    retries: 3,
  },
  { event: "stripe/charge.refunded" },
  async ({ event, step }) => {
    const { paymentIntentId } = event.data;

    // Find payment by payment_intent
    const payment = await step.run("get-payment", async () => {
      return await getPaymentByProviderId("stripe", paymentIntentId);
    });

    if (!payment) {
      throw new Error(`Payment not found for payment intent: ${paymentIntentId}`);
    }

    // Find session pack
    const sessionPack = await step.run("get-session-pack", async () => {
      return await getSessionPackByPaymentId(payment.id);
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment.id}`);
    }

    // Release the seat
    await step.run("release-seat", async () => {
      await releaseSeatByPackId(sessionPack.id);
    });

    // Mark pack as refunded
    await step.run("update-pack-status", async () => {
      await updateSessionPackStatus(sessionPack.id, "refunded", 0);
    });

    // Update payment status
    await step.run("update-payment-status", async () => {
      // Get refund amount from Stripe
      const charge = await stripe.charges.retrieve(event.data.chargeId);
      await updatePaymentStatus(
        payment.id,
        "refunded",
        (charge.amount_refunded / 100).toFixed(2)
      );
    });

    // Update order status
    await step.run("update-order-status", async () => {
      await updateOrderStatus(payment.orderId, "refunded");
    });

    return {
      success: true,
      sessionPackId: sessionPack.id,
      paymentId: payment.id,
    };
  }
);

