import { inngest } from "../client";
import { api } from "../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../convex/_generated/dataModel";
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

    await step.run("update-order", async () => {
      await convex.mutation(api.orders.completeOrder, {
        id: orderId as Id<"orders">,
      });
    });

    const paymentId = await step.run("create-payment", async () => {
      return await convex.mutation(api.payments.createPayment, {
        orderId: orderId as Id<"orders">,
        provider: "stripe",
        providerPaymentId: fullSession.payment_intent as string || sessionId,
        amount: fullSession.amount_total ? (fullSession.amount_total / 100).toString() : "0",
        currency: fullSession.currency?.toUpperCase() || "USD",
        status: "completed",
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
      if (!product.mentorId) {
        throw new Error(`Product has no mentorId: ${packId}`);
      }
      return await convex.mutation(api.sessionPacks.createSessionPack, {
        userId,
        mentorId: product.mentorId as Id<"instructors">,
        totalSessions: product.sessionsPerPack,
        remainingSessions: product.sessionsPerPack,
        expiresAt,
        paymentId: paymentId as Id<"payments">,
      });
    });

    const inventoryType = product.mentorshipType === "group" ? "group" : "oneOnOne";
    await step.run("decrement-inventory", async () => {
      if (!product.mentorId) {
        throw new Error(`Product has no mentorId: ${packId}`);
      }
      await convex.mutation(api.instructors.decrementInventory, {
        id: product.mentorId as Id<"instructors">,
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
      sessionPackId: sessionPack,
      paymentId: null,
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
        mentorId: sessionPack.mentorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find(p => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

    await step.run("refund-session-pack", async () => {
      await convex.mutation(api.sessionPacks.refundSessionPack, {
        id: sessionPack._id,
      });
    });

    await step.run("increment-inventory", async () => {
      await convex.mutation(api.instructors.incrementInventory, {
        id: sessionPack.mentorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    await step.run("update-payment-status", async () => {
      const charge = await stripe.charges.retrieve(event.data.chargeId);
      await convex.mutation(api.payments.refundPayment, {
        id: payment._id,
        refundedAmount: (charge.amount_refunded / 100).toFixed(2),
      });
    });

    await step.run("update-order-status", async () => {
      await convex.mutation(api.orders.refundOrder, {
        id: payment.orderId as Id<"orders">,
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
      if (!product.mentorId) {
        throw new Error(`Product has no mentorId: ${packId}`);
      }
      return await convex.mutation(api.sessionPacks.createSessionPack, {
        userId: order.userId,
        mentorId: product.mentorId as Id<"instructors">,
        totalSessions: product.sessionsPerPack,
        remainingSessions: product.sessionsPerPack,
        expiresAt,
        paymentId: payment as Id<"payments">,
      });
    });

    const paypalInventoryType = product.mentorshipType === "group" ? "group" : "oneOnOne";
    await step.run("decrement-inventory", async () => {
      if (!product.mentorId) {
        throw new Error(`Product has no mentorId: ${packId}`);
      }
      await convex.mutation(api.instructors.decrementInventory, {
        id: product.mentorId as Id<"instructors">,
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
      sessionPackId: sessionPack,
      paymentId: payment,
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
        mentorId: sessionPack.mentorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find(p => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

    await step.run("refund-session-pack", async () => {
      await convex.mutation(api.sessionPacks.refundSessionPack, {
        id: sessionPack._id,
      });
    });

    await step.run("increment-inventory", async () => {
      await convex.mutation(api.instructors.incrementInventory, {
        id: sessionPack.mentorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    await step.run("update-payment-status", async () => {
      await convex.mutation(api.payments.refundPayment, {
        id: payment._id,
        refundedAmount: payment.amount,
      });
    });

    await step.run("update-order-status", async () => {
      await convex.mutation(api.orders.refundOrder, {
        id: payment.orderId as Id<"orders">,
      });
    });

    return {
      success: true,
      sessionPackId: sessionPack._id,
      paymentId: payment._id,
    };
  }
);