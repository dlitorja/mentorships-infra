import { inngest } from "../../client";
import { Id } from "@/convex/_generated/dataModel";
import { convexServerCall } from "@/lib/convex-server-call";

/**
 * Processes a PayPal refund for a mentorship purchase.
 *
 * Triggered by: `paypal/payment.capture.refunded`
 *
 * Steps:
 * 1. Looks up the payment by PayPal capture ID
 * 2. Returns early if payment is already refunded (idempotency)
 * 3. Finds the associated session pack via payment ID
 * 4. Determines the inventory type (oneOnOne or group) from instructor products
 * 5. Refunds the session pack in Convex
 * 6. Syncs session pack status change to PostgreSQL
 * 7. Increments instructor inventory to restore availability
 * 8. Updates payment status to refunded in Convex
 * 9. Syncs payment status change to PostgreSQL
 * 10. Refunds the associated order in Convex
 * 11. Syncs order status change to PostgreSQL
 *
 * @returns Object with success status, sessionPackId, and paymentId
 */
export const processPayPalRefund = inngest.createFunction(
  {
    id: "process-paypal-refund",
    name: "Process PayPal Refund",
    retries: 3,
    triggers: [{ event: "paypal/payment.capture.refunded" }],
  },
  async ({ event, step }) => {
    const { captureId } = event.data;

    const payment = await step.run("get-payment", async () => {
      return await convexServerCall<any>("/payments/get-by-provider-id", {
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
      return await convexServerCall<any>("/session-packs/get-by-payment-id", {
        paymentId: payment._id,
      });
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment._id}`);
    }

    const instructorProducts = await step.run("get-instructor-products", async () => {
      return await convexServerCall<any>("/products/get-by-instructor-id", {
        instructorId: sessionPack.instructorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find((p: any) => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

    const refundedSessionPack = await step.run("refund-session-pack", async () => {
      return await convexServerCall<any>("/session-packs/refund", {
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
      await convexServerCall<any>("/inventory/increment", {
        instructorId: sessionPack.instructorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    const refundedPayment = await step.run("update-payment-status", async () => {
      return await convexServerCall<any>("/payments/refund", {
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
      return await convexServerCall<any>("/orders/refund", {
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
