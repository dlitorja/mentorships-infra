import { inngest } from "../../client";
import { Id } from "@/convex/_generated/dataModel";
import { convexServerCall } from "@/lib/convex-server-call";
import { sendEmail } from "@/lib/email";
import { reportInfo } from "@/lib/observability";
import { sendEmailLinkForUser } from "@/lib/clerk-magic-links";
import { onboardingFlow } from "../onboarding";
import {
  escapeHtml,
  findClerkUserIdByEmail,
  formatPrice,
  getInstructorNameFromClerk,
  parseEmailResult,
} from "../payments-helpers";
import type { PaypalPaymentCompletedEvent } from "../../types";

/**
 * Processes a completed PayPal payment capture to fulfill a mentorship purchase.
 *
 * Triggered by: `paypal/payment.capture.completed`
 *
 * Note: Unlike the Stripe flow, this does NOT emit data.sync/order.updated or
 * data.sync/payment.created events. Order and payment records are created in Convex
 * but are not replicated to the PostgreSQL replica. This is a pre-existing gap.
 *
 * Steps:
 * 1. Fetches and validates the order from Convex (with retry loop)
 * 2. Marks the order as paid in Convex (no sync event emitted)
 * 3. Creates a payment record in Convex with PayPal capture ID (no sync event emitted)
 * 4. Fetches the product to get instructorId and session count
 * 5. Creates a session pack in Convex, then emits data.sync/sessionPack.created
 * 6. Creates a seat reservation in Convex, then emits data.sync/seatReservation.created
 * 7. Ensures an admin-student workspace exists for post-purchase access
 * 8. Decrements instructor inventory (oneOnOne or group)
 * 9. Sends a purchase confirmation email with Clerk magic link for returning users
 * 10. Defers the onboarding flow via `defer()` (typed, fire-and-forget)
 *
 * @returns Object with success status, orderId, sessionPackId, and paymentId
 */
export const processPayPalCheckout = inngest.createFunction(
  {
    id: "process-paypal-checkout",
    name: "Process PayPal Checkout",
    retries: 3,
    triggers: [{ event: "paypal/payment.capture.completed" }],
  },
  async ({ event, step, defer }) => {
    const { captureId, orderId, packId } = event.data as unknown as PaypalPaymentCompletedEvent["data"];

    const order = await step.run("get-order", async () => {
      let attempts = 0;
      let foundOrder = null;
      while (attempts < 3 && !foundOrder) {
        foundOrder = await convexServerCall<any>("/orders/get-by-id-public", {
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
      await convexServerCall<any>("/orders/complete", {
        id: orderId as Id<"orders">,
      });
    });

    const payment = await step.run("create-payment", async () => {
      return await convexServerCall<any>("/payments/create", {
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
      const productData = await convexServerCall<any>("/products/get-public-by-id", {
        id: packId as Id<"products">,
      });
      if (!productData) {
        throw new Error(`Product not found: ${packId}`);
      }
      return productData;
    });

    const instructorName = await step.run("get-instructor-name", async () => {
      if (!product.instructorId) return "your instructor";
      return await getInstructorNameFromClerk(product.instructorId as Id<"instructors">, "your instructor");
    });

    const expiresAt = Date.now() + (product.validityDays || 60) * 24 * 60 * 60 * 1000;

    const sessionPack = await step.run("create-session-pack", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      return await convexServerCall<any>("/session-packs/create", {
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
        return await convexServerCall<any>("/seat-reservations/create", {
          instructorId: product.instructorId as Id<"instructors">,
          userId: order.userId,
          sessionPackId: sessionPack._id as Id<"sessionPacks">,
          seatExpiresAt: expiresAt,
          gracePeriodEndsAt: expiresAt + (7 * 24 * 60 * 60 * 1000),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          const existing = await convexServerCall<any>("/seat-reservations/get-by-session-pack", {
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
      return await convexServerCall<any>("/workspaces/ensure-admin-student", { studentUserId: order.userId });
    });

    await step.run("sync-seat-reservation-created", async () => {
      await inngest.send({
        name: "data.sync/seatReservation.created",
        data: {
          id: seatReservation._id,
          userId: seatReservation.userId,
          instructorId: seatReservation.instructorId as Id<"instructors">,
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
      await convexServerCall<any>("/inventory/decrement", {
        instructorId: product.instructorId as Id<"instructors">,
        type: paypalInventoryType,
      });
    });

    // Post-purchase confirmation email (Resend) for ALL purchasers with an email address
    const sessionsCount = product.sessionsPerPack || 0;
    const pricePaid = order.totalAmount || null;
    const currency = (order.currency ?? "USD").toUpperCase();

    await step.run("send-purchase-confirmation-email", async () => {
      const email = ((event.data as any)?.studentEmail as string | undefined)?.trim().toLowerCase() || "";
      if (!email) return { skipped: true } as const;

      const baseUrl = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

      // Check if a Clerk user already exists for this email address
      const existingClerkUserId = await findClerkUserIdByEmail(email);

      // Determine the userId to use for magic link: prefer order userId, fallback to existing Clerk user
      const clerkId = order.userId as string;
      const isGuest = !clerkId || clerkId === "guest" || clerkId.startsWith("email:");
      const isClerkUser = !isGuest;
      const clerkUserIdForMagicLink = isClerkUser ? clerkId : existingClerkUserId;

      // Send a Clerk magic link so the user can access their account regardless of whether
      // they are "new" (created during checkout) or returning. Clerk's prepareVerification
      // skips sending if the email is already verified, so this is safe to call always.
      let magicLinkSent = false;
      if (clerkUserIdForMagicLink) {
        const magicLinkRedirectUrl = `${baseUrl}/sign-in`;
        const magicLinkResult = await sendEmailLinkForUser(clerkUserIdForMagicLink, magicLinkRedirectUrl);
        magicLinkSent = magicLinkResult.ok;
        await reportInfo({
          source: "inngest:process-paypal-checkout",
          message: magicLinkResult.ok ? "Magic link sent" : `Magic link failed: ${magicLinkResult.error}`,
          level: magicLinkResult.ok ? "info" : "warn",
          context: { orderId, ok: magicLinkSent, hasExistingClerkAccount: !!existingClerkUserId },
        });
      } else {
        await reportInfo({
          source: "inngest:process-paypal-checkout",
          message: "No Clerk account found, sending create account email",
          level: "info",
          context: { orderId },
        });
      }

      // Branch on whether the magic link was actually sent:
      // - magicLinkSent: Clerk account exists, magic link was delivered → guide to check inbox
      // - !magicLinkSent: No Clerk account or link failed → guide to create account
      const html = magicLinkSent
        ? `<div style="font-family:Arial,sans-serif;color:#111">
            <h2 style="margin:0 0 12px">Your mentorship purchase is confirmed</h2>
            <p style="margin:0 0 16px">Thank you for your purchase! We've sent a login link to your email — click it to access your dashboard and start booking sessions.</p>
            <table style="border-collapse:collapse;margin:0 0 16px">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:120px">Instructor</td>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:500">${escapeHtml(instructorName)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Sessions</td>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:500">${sessionsCount} sessions</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b7280">Total paid</td>
                <td style="padding:8px 0;font-weight:500">${formatPrice(pricePaid, currency)}</td>
              </tr>
            </table>
            <p style="margin:0 0 16px"><a href="${baseUrl}/sign-in" style="background:#111;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Sign in to your account</a></p>
            <p style="margin:8px 0 0;font-size:14px">Didn't receive the email? Check your spam folder or <a href="${baseUrl}/sign-in">sign in</a> to resend it.</p>
          </div>`
        : `<div style="font-family:Arial,sans-serif;color:#111">
            <h2 style="margin:0 0 12px">Your mentorship purchase is confirmed</h2>
            <p style="margin:0 0 16px">Thank you for your purchase! Complete your account setup to access your session pack. This will also verify your email address.</p>
            <table style="border-collapse:collapse;margin:0 0 16px">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:120px">Instructor</td>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:500">${escapeHtml(instructorName)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">Sessions</td>
                <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:500">${sessionsCount} sessions</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#6b7280">Total paid</td>
                <td style="padding:8px 0;font-weight:500">${formatPrice(pricePaid, currency)}</td>
              </tr>
            </table>
            <p style="margin:0 0 16px"><a href="${baseUrl}/sign-up" style="background:#111;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Create your account</a></p>
            <p style="margin:8px 0 0;font-size:14px">Already have an account? <a href="${baseUrl}/sign-in">Sign in</a></p>
          </div>`;

      const res = await sendEmail({
        to: email,
        subject: magicLinkSent
          ? "Your mentorship purchase is confirmed — Check your email for your login link"
          : "Your mentorship purchase is confirmed — Create your account",
        html,
        headers: { "X-Email-Type": magicLinkSent ? "purchase_confirmation" : "guest_onboarding", "X-Order-Id": orderId, "X-Provider": "paypal" },
      });

      const parsedResult = parseEmailResult(res);
      await reportInfo({
        source: "inngest:process-paypal-checkout",
        message: res.ok ? "Purchase confirmation email sent" : "Purchase confirmation email skipped/failed",
        level: res.ok ? "info" : "warn",
        context: { orderId, ok: parsedResult.ok },
      });
    });

    await step.run("trigger-onboarding", async () => {
      defer("trigger-onboarding", {
        function: onboardingFlow,
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
