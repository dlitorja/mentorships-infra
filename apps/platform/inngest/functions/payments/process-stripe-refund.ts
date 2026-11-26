import { inngest } from "../../client";
import { Id } from "@/convex/_generated/dataModel";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportInfo } from "@/lib/observability";

/**
 * Processes a Stripe refund for a mentorship purchase.
 *
 * Triggered by: `stripe/charge.refunded` (and re-emitted by
 * `charge.refund.updated` when a refund's status changes).
 *
 * The event carries Stripe's **cumulative** `amount_refunded` for the charge,
 * not the delta for this event. This function diffs it against the amount
 * already recorded on the payment, so:
 *
 * - a $1 partial refund records $1 and leaves the pack, inventory, and seat
 *   untouched;
 * - a second refund that brings the total to the original amount records the
 *   remainder, then flips the pack/order/payment to refunded, restores one
 *   inventory unit, and releases the seat;
 * - a replay with no new amount is a no-op.
 *
 * The previous implementation ignored `amount_refunded` entirely and treated
 * every `charge.refunded` (including a partial) as a full refund.
 *
 * @returns Object with the recorded refund amount and whether it completed the refund.
 */
export const processStripeRefund = inngest.createFunction(
  {
    id: "process-stripe-refund",
    name: "Process Stripe Refund",
    retries: 3,
    triggers: [{ event: "stripe/charge.refunded" }],
  },
  async ({ event, step }) => {
    const { paymentIntentId, amountRefunded } = event.data as {
      paymentIntentId: string;
      amountRefunded?: number;
      chargeAmount?: number;
    };

    const payment = await step.run("get-payment", async () => {
      return await convexServerCall<any>("/payments/get-by-provider-id", {
        provider: "stripe",
        providerPaymentId: paymentIntentId,
      });
    });

    if (!payment) {
      throw new Error(`Payment not found for payment intent: ${paymentIntentId}`);
    }

    const originalAmount = Number(payment.amount);
    const priorRefunded = Number(payment.refundedAmount || "0");

    // Stripe reports cents. Fall back to "full refund" only when the event
    // carries no amount (older test payloads), which matches the pre-fix
    // behaviour rather than silently recording zero.
    const cumulativeRefunded =
      typeof amountRefunded === "number" && amountRefunded >= 0
        ? amountRefunded / 100
        : originalAmount;

    const delta = Math.round((cumulativeRefunded - priorRefunded) * 100) / 100;

    if (!Number.isFinite(delta) || delta <= 0) {
      await reportInfo({
        source: "inngest:process-stripe-refund",
        message: "Refund already recorded; skipping",
        level: "info",
        context: {
          paymentIntentId,
          paymentId: payment._id,
          cumulativeRefunded,
          priorRefunded,
        },
      });
      return {
        success: true,
        alreadyRecorded: true,
        paymentId: payment._id,
        refundedAmount: priorRefunded.toFixed(2),
      };
    }

    const updatedPayment = await step.run("record-refund", async () => {
      return await convexServerCall<any>("/payments/apply-refund", {
        paymentId: payment._id as Id<"payments">,
        refundAmount: delta.toFixed(2),
      });
    });

    if (!updatedPayment) {
      throw new Error("Failed to record refund on payment");
    }

    await step.run("sync-payment-updated", async () => {
      await inngest.send({
        name: "data.sync/payment.updated",
        data: {
          id: updatedPayment._id,
          orderId: updatedPayment.orderId,
          status: updatedPayment.status,
          refundedAmount: updatedPayment.refundedAmount ?? null,
          updatedAt: Date.now(),
        },
      });
    });

    const fullyRefunded = updatedPayment.status === "refunded";

    if (!fullyRefunded) {
      await step.run("sync-order-updated", async () => {
        await inngest.send({
          name: "data.sync/order.updated",
          data: {
            id: updatedPayment.orderId,
            status: "paid",
            updatedAt: Date.now(),
          },
        });
      });

      await reportInfo({
        source: "inngest:process-stripe-refund",
        message: "Partial refund recorded; pack, inventory, and seat unchanged",
        level: "info",
        context: {
          paymentIntentId,
          paymentId: updatedPayment._id,
          delta,
          refundedAmount: updatedPayment.refundedAmount,
          originalAmount,
        },
      });

      return {
        success: true,
        fullyRefunded: false,
        paymentId: updatedPayment._id,
        refundedAmount: updatedPayment.refundedAmount,
      };
    }

    // Fully refunded: now (and only now) close the pack, restore inventory,
    // and release the seat. Order status was already flipped to "refunded"
    // inside `applyRefundCumulative`.
    const sessionPack = await step.run("get-session-pack", async () => {
      return await convexServerCall<any>("/session-packs/get-by-payment-id", {
        paymentId: payment._id,
      });
    });

    if (sessionPack) {
      const instructorProducts = await step.run("get-instructor-products", async () => {
        return await convexServerCall<any>("/products/get-by-instructor-id", {
          instructorId: sessionPack.instructorId as Id<"instructors">,
        });
      });

      const product = instructorProducts.find(
        (p: any) => p.sessionsPerPack === sessionPack.totalSessions
      );
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

      await step.run("release-seat", async () => {
        return await convexServerCall<any>("/seat-reservations/release-by-pack", {
          sessionPackId: sessionPack._id as Id<"sessionPacks">,
        });
      });
    }

    await step.run("sync-order-updated", async () => {
      await inngest.send({
        name: "data.sync/order.updated",
        data: {
          id: updatedPayment.orderId,
          status: "refunded",
          updatedAt: Date.now(),
        },
      });
    });

    return {
      success: true,
      fullyRefunded: true,
      paymentId: updatedPayment._id,
      sessionPackId: sessionPack?._id ?? null,
      refundedAmount: updatedPayment.refundedAmount,
    };
  }
);
