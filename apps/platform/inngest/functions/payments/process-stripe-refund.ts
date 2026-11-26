import { clerkClient } from "@clerk/nextjs/server";
import { inngest } from "../../client";
import { Id } from "@/convex/_generated/dataModel";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportError, reportInfo } from "@/lib/observability";
import { buildRefundEmail } from "@/lib/emails/refund-email";
import { sendEmail } from "@/lib/email";

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
    const { paymentIntentId, amountRefunded, chargeId } = event.data as {
      paymentIntentId: string;
      amountRefunded?: number;
      chargeAmount?: number;
      chargeId?: string;
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

    // Concurrency-safe: send the CUMULATIVE total and let the mutation compute
    // the delta. Two deliveries of the same event then produce one write and
    // one zero-delta no-op instead of adding the same refund twice.
    const recorded = await step.run("record-refund", async () => {
      return await convexServerCall<any>("/payments/apply-refund", {
        paymentId: payment._id as Id<"payments">,
        refundedTotal: cumulativeRefunded.toFixed(2),
      });
    });

    if (!recorded?.payment) {
      throw new Error("Failed to record refund on payment");
    }

    const updatedPayment = recorded.payment;
    const appliedDelta = Number(recorded.applied ?? 0);

    if (!Number.isFinite(appliedDelta) || appliedDelta <= 0) {
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

    const sessionPack = await step.run("get-session-pack", async () => {
      return await convexServerCall<any>("/session-packs/get-by-payment-id", {
        paymentId: payment._id,
      });
    });

    // Provider-initiated refunds used to send no email at all: only the admin
    // route notified the student, so a refund issued from the Stripe dashboard
    // felt like money silently disappearing. Resolve the student from the
    // order (Clerk id or `email:` placeholder) and send the same template the
    // admin route uses.
    await step.run("send-refund-email", async () => {
      try {
        const order = await convexServerCall<any>("/orders/get-by-id-internal", {
          id: updatedPayment.orderId,
        });
        if (!order?.userId) return { skipped: true, reason: "no_order" };

        let email: string | null = null;
        let studentName: string | null = null;

        if (order.userId.startsWith("email:")) {
          email = order.userId.slice("email:".length);
        } else if (order.userId.startsWith("user_")) {
          const clerk = await clerkClient();
          const user = await clerk.users.getUser(order.userId);
          email = user.emailAddresses[0]?.emailAddress ?? null;
          studentName =
            [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null;
        }

        if (!email) return { skipped: true, reason: "no_email" };

        const instructorName = sessionPack?.instructorId
          ? await convexServerCall<string | null>("/instructors/get-name-by-id", {
              id: sessionPack.instructorId,
            }).catch(() => null)
          : null;

        const baseUrl =
          process.env.NEXT_PUBLIC_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

        const content = buildRefundEmail({
          studentName: studentName ?? email,
          instructorName: instructorName ?? "your instructor",
          // The amount returned by THIS refund, not the running total: a second
          // $10 refund must not read as "$20 refunded" to the student.
          refundAmount: appliedDelta.toFixed(2),
          currency: (updatedPayment.currency ?? "usd").toString(),
          reason: "Other",
          customReason: "Refunded by Stripe",
          dashboardUrl: `${baseUrl}/dashboard`,
          provider: "stripe",
          providerReference: chargeId ?? null,
        });

        const result = await sendEmail({
          to: email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          headers: content.headers,
          kind: "transactional",
          idempotencyKey: `refund-email:${payment._id}:${updatedPayment.refundedAmount}`,
        });

        if (!result.ok) {
          await reportError({
            source: "inngest:process-stripe-refund",
            error: result,
            message: "Refund email failed",
            level: "warn",
            context: { paymentId: payment._id, orderId: updatedPayment.orderId },
          });
        }

        return { sent: result.ok };
      } catch (emailError) {
        await reportError({
          source: "inngest:process-stripe-refund",
          error: emailError,
          message: "Refund email threw; refund itself is recorded",
          level: "warn",
          context: { paymentId: payment._id },
        });
        return { sent: false };
      }
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
          appliedDelta,
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

    // Fully refunded: one shared close-out decides whether the pack closes,
    // keeps carried credits, or removes rolled-over credits. It also owns the
    // seat release and inventory restore, so the admin and webhook paths
    // cannot each add a seat for the same refund.
    if (sessionPack) {
      const closeOut = await step.run("close-out-refund", async () => {
        return await convexServerCall<any>("/session-packs/refund-closeout", {
          sessionPackId: sessionPack._id,
        });
      });

      await step.run("sync-session-pack-updated", async () => {
        await inngest.send({
          name: "data.sync/sessionPack.updated",
          data: {
            id: sessionPack._id,
            status: closeOut?.closed ? "refunded" : "active",
            updatedAt: Date.now(),
          },
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
