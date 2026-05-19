import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../convex/_generated/dataModel";
import { stripe } from "../../lib/stripe";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

export const processStripeCheckout = inngest.createFunction(
  { id: "process-stripe-checkout", name: "Process Stripe Checkout", retries: 3 },
  { event: "stripe/checkout.session.completed" },
  async ({ event, step }) => {
    const { sessionId, orderId, userId, packId } = event.data;
  const convex = getConvexClient();

    const order = await step.run("get-order", async () => {
      let attempts = 0;
      let foundOrder = null;
      while (attempts < 3 && !foundOrder) {
        foundOrder = await convex.query(api.orders.getOrderByIdPublic, {
          id: orderId as Id<"orders">,
        });
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

    if (order.status === "paid") {
      return { message: "Order already processed", orderId, alreadyProcessed: true };
    }

    const fullSession = await step.run("get-stripe-session", async () => {
      return await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["total_details.breakdown.discounts"],
      });
    });

    const discountAmount = fullSession.total_details?.amount_discount
      ? (fullSession.total_details.amount_discount / 100).toString()
      : null;
    const originalAmount = fullSession.amount_subtotal
      ? (fullSession.amount_subtotal / 100).toString()
      : null;

    let discountCode: string | null = null;
    if (
      fullSession.total_details?.breakdown?.discounts &&
      fullSession.total_details.breakdown.discounts.length > 0
    ) {
      const discount = fullSession.total_details.breakdown.discounts[0];
      if (discount.discount?.promotion_code) {
        const promotionCode = discount.discount.promotion_code;
        if (typeof promotionCode === "object" && promotionCode !== null) {
          discountCode = promotionCode.code || promotionCode.id || null;
        } else if (typeof promotionCode === "string") {
          discountCode = promotionCode;
        }
      } else if (discount.discount?.coupon) {
        discountCode = discount.discount.coupon.id || discount.discount.coupon.name || null;
      }
    }

const completedOrder = await step.run("update-order", async () => {
      return await convex.mutation(api.orders.completeOrder, {
        id: orderId as Id<"orders">,
      });
    });

    if (!completedOrder) {
      throw new Error("Failed to complete order");
    }

    await step.run("sync-order-updated", async () => {
      await inngest.send({
        name: "data.sync/order.updated",
        data: {
          id: completedOrder._id,
          status: completedOrder.status,
          updatedAt: Date.now(),
        },
      });
    });

    const payment = await step.run("create-payment", async () => {
      return await convex.mutation(api.payments.createPayment, {
        orderId: orderId as Id<"orders">,
        provider: "stripe",
        providerPaymentId: fullSession.payment_intent as string || sessionId,
        amount: fullSession.amount_total ? (fullSession.amount_total / 100).toString() : "0",
        currency: fullSession.currency?.toUpperCase() || "USD",
        status: "completed",
      });
    });

    if (!payment) {
      throw new Error("Failed to create payment");
    }

    await step.run("sync-payment-created", async () => {
      await inngest.send({
        name: "data.sync/payment.created",
        data: {
          id: payment._id,
          orderId: payment.orderId,
          provider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          refundedAmount: payment.refundedAmount ?? null,
          createdAt: payment._creationTime,
          updatedAt: Date.now(),
        },
      });
    });

    const product = await step.run("get-product", async () => {
      const productData = await convex.query(api.products.getProductById, {
        id: packId as Id<"products">,
      });
      if (!productData) {
        throw new Error(`Product not found: ${packId}`);
      }
      return productData;
    });

    const expiresAt = Date.now() + (product.validityDays || 60) * 24 * 60 * 60 * 1000;

    const sessionPack = await step.run("create-session-pack", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      return await convex.mutation(api.sessionPacks.createSessionPack, {
        userId,
        instructorId: product.instructorId as Id<"instructors">,
        totalSessions: product.sessionsPerPack,
        remainingSessions: product.sessionsPerPack,
        expiresAt,
        paymentId: payment._id as Id<"payments">,
      });
    });

    if (!sessionPack) {
      throw new Error("Failed to create session pack");
    }

    await step.run("sync-session-pack-created", async () => {
      await inngest.send({
        name: "data.sync/sessionPack.created",
        data: {
          id: sessionPack._id,
          userId: sessionPack.userId,
          instructorId: sessionPack.instructorId,
          totalSessions: sessionPack.totalSessions,
          remainingSessions: sessionPack.remainingSessions,
          purchasedAt: sessionPack.purchasedAt,
          expiresAt: sessionPack.expiresAt ?? null,
          status: sessionPack.status,
          paymentId: sessionPack.paymentId,
          createdAt: sessionPack._creationTime,
          updatedAt: Date.now(),
        },
      });
    });

    const seatReservation = await step.run("create-seat-and-workspace", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      try {
        return await convex.mutation(api.seatReservations.createSeatReservation, {
          instructorId: product.instructorId as Id<"instructors">,
          userId,
          sessionPackId: sessionPack._id as Id<"sessionPacks">,
          seatExpiresAt: expiresAt,
          gracePeriodEndsAt: expiresAt + (7 * 24 * 60 * 60 * 1000),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          const existing = await convex.query(api.seatReservations.getSeatReservationBySessionPack, {
            sessionPackId: sessionPack._id as Id<"sessionPacks">,
          });
          if (existing) {
            return existing;
          }
        }
        throw error;
      }
    });

    if (!seatReservation) {
      throw new Error("Failed to create or find seat reservation");
    }

    // Ensure an admin-student workspace exists (post-payment) for buyer ↔ admins
    await step.run("ensure-admin-student-workspace", async () => {
      const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
      const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
      if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
        // Skip silently if not configured in this environment
        return { skipped: true } as const;
      }
      const res = await fetch(`${CONVEX_DEPLOYMENT_URL}/api/workspaces/ensure-admin-student`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        },
        body: JSON.stringify({ studentUserId: userId }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ensure-admin-student failed: ${res.status} ${body}`);
      }
      return await res.json();
    });

    await step.run("sync-seat-reservation-created", async () => {
      await inngest.send({
        name: "data.sync/seatReservation.created",
        data: {
          id: seatReservation._id,
          userId: seatReservation.userId,
          instructorId: seatReservation.instructorId,
          sessionPackId: seatReservation.sessionPackId,
          status: seatReservation.status,
          seatExpiresAt: seatReservation.seatExpiresAt ?? null,
          gracePeriodEndsAt: seatReservation.gracePeriodEndsAt ?? null,
          createdAt: seatReservation._creationTime,
          updatedAt: Date.now(),
        },
      });
    });

    const inventoryType = product.mentorshipType === "group" ? "group" : "oneOnOne";
    await step.run("decrement-inventory", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      await convex.mutation(api.instructors.decrementInventory, {
        id: product.instructorId as Id<"instructors">,
        type: inventoryType,
      });
    });

    await step.run("trigger-onboarding", async () => {
      await inngest.send({
        name: "purchase/mentorship",
        data: {
          orderId,
          clerkId: userId,
          packId,
          provider: "stripe",
        },
      });
    });

    return {
      success: true,
      orderId,
      sessionPackId: sessionPack._id,
      paymentId: payment._id,
    };
  }
);

export const processStripeRefund = inngest.createFunction(
  { id: "process-stripe-refund", name: "Process Stripe Refund", retries: 3 },
  { event: "stripe/charge.refunded" },
  async ({ event, step }) => {
    const { paymentIntentId } = event.data;
    const convex = getConvexClient();

    const payment = await step.run("get-payment", async () => {
      return await convex.query(api.payments.getPaymentByProviderId, {
        provider: "stripe",
        providerPaymentId: paymentIntentId,
      });
    });

    if (!payment) {
      throw new Error(`Payment not found for payment intent: ${paymentIntentId}`);
    }

    const sessionPack = await step.run("get-session-pack", async () => {
      return await convex.query(api.sessionPacks.getSessionPackByPaymentId, {
        paymentId: payment._id,
      });
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment._id}`);
    }

    const instructorProducts = await step.run("get-instructor-products", async () => {
      return await convex.query(api.products.getProductsByInstructorId, {
        instructorId: sessionPack.instructorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find(p => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

const refundedSessionPack = await step.run("refund-session-pack", async () => {
      return await convex.mutation(api.sessionPacks.refundSessionPack, {
        id: sessionPack._id,
      });
    });

    if (!refundedSessionPack) {
      throw new Error("Failed to refund session pack");
    }

    await step.run("sync-session-pack-updated", async () => {
      await inngest.send({
        name: "data.sync/sessionPack.updated",
        data: {
          id: refundedSessionPack._id,
          status: refundedSessionPack.status,
          updatedAt: Date.now(),
        },
      });
    });

    await step.run("increment-inventory", async () => {
      await convex.mutation(api.instructors.incrementInventory, {
        id: sessionPack.instructorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    const refundedPayment = await step.run("update-payment-status", async () => {
      return await convex.mutation(api.payments.refundPayment, {
        id: payment._id,
        refundedAmount: payment.amount,
      });
    });

    if (!refundedPayment) {
      throw new Error("Failed to refund payment");
    }

    await step.run("sync-payment-updated", async () => {
      await inngest.send({
        name: "data.sync/payment.updated",
        data: {
          id: refundedPayment._id,
          orderId: refundedPayment.orderId,
          status: refundedPayment.status,
          refundedAmount: refundedPayment.refundedAmount ?? null,
          updatedAt: Date.now(),
        },
      });
    });

    const refundedOrder = await step.run("update-order-status", async () => {
      return await convex.mutation(api.orders.refundOrder, {
        id: payment.orderId as Id<"orders">,
      });
    });

    if (!refundedOrder) {
      throw new Error("Failed to refund order");
    }

    await step.run("sync-order-updated", async () => {
      await inngest.send({
        name: "data.sync/order.updated",
        data: {
          id: refundedOrder._id,
          status: refundedOrder.status,
          updatedAt: Date.now(),
        },
      });
    });

    return {
      success: true,
      sessionPackId: sessionPack._id,
      paymentId: payment._id,
    };
  }
);

export const processPayPalCheckout = inngest.createFunction(
  { id: "process-paypal-checkout", name: "Process PayPal Checkout", retries: 3 },
  { event: "paypal/payment.capture.completed" },
  async ({ event, step }) => {
    const { captureId, orderId, packId } = event.data;
    const convex = getConvexClient();

    const order = await step.run("get-order", async () => {
      let attempts = 0;
      let foundOrder = null;
      while (attempts < 3 && !foundOrder) {
        foundOrder = await convex.query(api.orders.getOrderByIdPublic, {
          id: orderId as Id<"orders">,
        });
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

    if (order.status === "paid") {
      return { message: "Order already processed", orderId, alreadyProcessed: true };
    }

    await step.run("update-order", async () => {
      await convex.mutation(api.orders.completeOrder, {
        id: orderId as Id<"orders">,
      });
    });

    const payment = await step.run("create-payment", async () => {
      return await convex.mutation(api.payments.createPayment, {
        orderId: orderId as Id<"orders">,
        provider: "paypal",
        providerPaymentId: captureId,
        amount: order.totalAmount,
        currency: (order.currency ?? "USD").toUpperCase(),
        status: "completed",
      });
    });

    if (!payment) {
      throw new Error("Failed to create payment");
    }

    const product = await step.run("get-product", async () => {
      const productData = await convex.query(api.products.getProductById, {
        id: packId as Id<"products">,
      });
      if (!productData) {
        throw new Error(`Product not found: ${packId}`);
      }
      return productData;
    });

    const expiresAt = Date.now() + (product.validityDays || 60) * 24 * 60 * 60 * 1000;

    const sessionPack = await step.run("create-session-pack", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      return await convex.mutation(api.sessionPacks.createSessionPack, {
        userId: order.userId,
        instructorId: product.instructorId as Id<"instructors">,
        totalSessions: product.sessionsPerPack,
        remainingSessions: product.sessionsPerPack,
        expiresAt,
        paymentId: payment._id as Id<"payments">,
      });
    });

    if (!sessionPack) {
      throw new Error("Failed to create session pack");
    }

    await step.run("sync-session-pack-created", async () => {
      await inngest.send({
        name: "data.sync/sessionPack.created",
        data: {
          id: sessionPack._id,
          userId: sessionPack.userId,
          instructorId: sessionPack.instructorId,
          totalSessions: sessionPack.totalSessions,
          remainingSessions: sessionPack.remainingSessions,
          purchasedAt: sessionPack.purchasedAt,
          expiresAt: sessionPack.expiresAt ?? null,
          status: sessionPack.status,
          paymentId: sessionPack.paymentId,
          createdAt: sessionPack._creationTime,
          updatedAt: Date.now(),
        },
      });
    });

  const seatReservation = await step.run("create-seat-and-workspace", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      try {
        return await convex.mutation(api.seatReservations.createSeatReservation, {
          instructorId: product.instructorId as Id<"instructors">,
          userId: order.userId,
          sessionPackId: sessionPack._id as Id<"sessionPacks">,
          seatExpiresAt: expiresAt,
          gracePeriodEndsAt: expiresAt + (7 * 24 * 60 * 60 * 1000),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          const existing = await convex.query(api.seatReservations.getSeatReservationBySessionPack, {
            sessionPackId: sessionPack._id as Id<"sessionPacks">,
          });
          if (existing) {
            return existing;
          }
        }
        throw error;
      }
    });

  if (!seatReservation) {
    throw new Error("Failed to create or find seat reservation");
  }

  // Ensure an admin-student workspace exists (post-payment) for buyer ↔ admins
  await step.run("ensure-admin-student-workspace", async () => {
    const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
    const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
    if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
      return { skipped: true } as const;
    }
    const res = await fetch(`${CONVEX_DEPLOYMENT_URL}/api/workspaces/ensure-admin-student`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
      },
      body: JSON.stringify({ studentUserId: order.userId }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ensure-admin-student failed: ${res.status} ${body}`);
    }
    return await res.json();
  });

    await step.run("sync-seat-reservation-created", async () => {
      await inngest.send({
        name: "data.sync/seatReservation.created",
        data: {
          id: seatReservation._id,
          userId: seatReservation.userId,
          instructorId: seatReservation.instructorId,
          sessionPackId: seatReservation.sessionPackId,
          status: seatReservation.status,
          seatExpiresAt: seatReservation.seatExpiresAt ?? null,
          gracePeriodEndsAt: seatReservation.gracePeriodEndsAt ?? null,
          createdAt: seatReservation._creationTime,
          updatedAt: Date.now(),
        },
      });
    });

    const paypalInventoryType = product.mentorshipType === "group" ? "group" : "oneOnOne";
    await step.run("decrement-inventory", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      await convex.mutation(api.instructors.decrementInventory, {
        id: product.instructorId as Id<"instructors">,
        type: paypalInventoryType,
      });
    });

    await step.run("trigger-onboarding", async () => {
      await inngest.send({
        name: "purchase/mentorship",
        data: {
          orderId,
          clerkId: order.userId,
          packId,
          provider: "paypal",
        },
      });
    });

    return {
      success: true,
      orderId,
      sessionPackId: sessionPack._id,
      paymentId: payment._id,
    };
  }
);

export const processPayPalRefund = inngest.createFunction(
  { id: "process-paypal-refund", name: "Process PayPal Refund", retries: 3 },
  { event: "paypal/payment.capture.refunded" },
  async ({ event, step }) => {
    const { captureId } = event.data;
    const convex = getConvexClient();

    const payment = await step.run("get-payment", async () => {
      return await convex.query(api.payments.getPaymentByProviderId, {
        provider: "paypal",
        providerPaymentId: captureId,
      });
    });

    if (!payment) {
      throw new Error(`Payment not found for capture: ${captureId}`);
    }

    if (payment.status === "refunded") {
      return {
        message: "Payment already refunded",
        paymentId: payment._id,
        alreadyProcessed: true,
      };
    }

    const sessionPack = await step.run("get-session-pack", async () => {
      return await convex.query(api.sessionPacks.getSessionPackByPaymentId, {
        paymentId: payment._id,
      });
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment._id}`);
    }

    const instructorProducts = await step.run("get-instructor-products", async () => {
      return await convex.query(api.products.getProductsByInstructorId, {
        instructorId: sessionPack.instructorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find(p => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

const refundedSessionPack = await step.run("refund-session-pack", async () => {
      return await convex.mutation(api.sessionPacks.refundSessionPack, {
        id: sessionPack._id,
      });
    });

    if (!refundedSessionPack) {
      throw new Error("Failed to refund session pack");
    }

    await step.run("sync-session-pack-updated", async () => {
      await inngest.send({
        name: "data.sync/sessionPack.updated",
        data: {
          id: refundedSessionPack._id,
          status: refundedSessionPack.status,
          updatedAt: Date.now(),
        },
      });
    });

    await step.run("increment-inventory", async () => {
      await convex.mutation(api.instructors.incrementInventory, {
        id: sessionPack.instructorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    const refundedPayment = await step.run("update-payment-status", async () => {
      return await convex.mutation(api.payments.refundPayment, {
        id: payment._id,
        refundedAmount: payment.amount,
      });
    });

    if (!refundedPayment) {
      throw new Error("Failed to refund payment");
    }

    await step.run("sync-payment-updated", async () => {
      await inngest.send({
        name: "data.sync/payment.updated",
        data: {
          id: refundedPayment._id,
          orderId: refundedPayment.orderId,
          status: refundedPayment.status,
          refundedAmount: refundedPayment.refundedAmount ?? null,
          updatedAt: Date.now(),
        },
      });
    });

    const refundedOrder = await step.run("update-order-status", async () => {
      return await convex.mutation(api.orders.refundOrder, {
        id: payment.orderId as Id<"orders">,
      });
    });

    if (!refundedOrder) {
      throw new Error("Failed to refund order");
    }

    await step.run("sync-order-updated", async () => {
      await inngest.send({
        name: "data.sync/order.updated",
        data: {
          id: refundedOrder._id,
          status: refundedOrder.status,
          updatedAt: Date.now(),
        },
      });
    });

    return {
      success: true,
      sessionPackId: sessionPack._id,
      paymentId: payment._id,
    };
  }
);
