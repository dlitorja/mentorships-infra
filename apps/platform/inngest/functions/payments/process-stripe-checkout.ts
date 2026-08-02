import { inngest } from "../../client";
import { Id } from "@/convex/_generated/dataModel";
import { convexServerCall } from "@/lib/convex-server-call";
import { stripe } from "@/lib/stripe";
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

/**
 * Processes a completed Stripe checkout session to fulfill a mentorship purchase.
 *
 * Triggered by: `stripe/checkout.session.completed`
 *
 * Steps:
 * 1. Fetches and validates the order from Convex (with retry loop)
 * 2. Retrieves the full Stripe session with discount details
 * 3. Extracts discount code from promotion/coupon if present
 * 4. Marks the order as paid in Convex, then emits data.sync/order.updated
 * 5. Creates a payment record in Convex, then emits data.sync/payment.created
 * 6. Fetches the product to get instructorId and session count
 * 7. Resolves userId (supports guest checkout with email-based placeholder)
 * 8. Creates a session pack in Convex, then emits data.sync/sessionPack.created
 * 9. Creates a seat reservation in Convex, then emits data.sync/seatReservation.created
 * 10. Ensures an admin-student workspace exists for post-purchase access
 * 11. Decrements instructor inventory (oneOnOne or group)
 * 12. Sends a purchase confirmation email with Clerk magic link for returning users
 * 13. Defers the onboarding flow via `defer()` (typed, fire-and-forget)
 *
 * @returns Object with success status, orderId, sessionPackId, and paymentId
 */
export const processStripeCheckout = inngest.createFunction(
  {
    id: "process-stripe-checkout",
    name: "Process Stripe Checkout",
    retries: 3,
    triggers: [{ event: "stripe/checkout.session.completed" }],
  },
  async ({ event, step, defer }) => {
    const { sessionId, orderId, userId, packId, studentEmail } = event.data as {
      sessionId: string;
      orderId: string;
      userId: string;
      packId: string;
      studentEmail?: string;
    };

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

    const fullSession = await step.run("get-stripe-session", async () => {
      return await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["total_details.breakdown.discounts"],
      });
    });

    const completedOrder = await step.run("update-order", async () => {
      return await convexServerCall<any>("/orders/complete", {
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
      return await convexServerCall<any>("/payments/create", {
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

    // Resolve userId for guest checkout using Stripe-collected email
    const resolvedUserId = await step.run("resolve-user-id", async () => {
      if (userId && userId !== "guest") return userId;
      const email = studentEmail?.toLowerCase().trim();
      if (!email) return "guest";
      // Ensure a Convex user exists for this email; use a placeholder userId that will be
      // replaced later by syncUser when the visitor signs up with Clerk.
      const placeholderUserId = `email:${email}`;
      try {
        await convexServerCall<any>("/users/create", {
          userId: placeholderUserId,
          email,
          role: "student",
        });
      } catch {
        // Ignore if already exists
      }
      return placeholderUserId;
    });

    const sessionPack = await step.run("create-session-pack", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      return await convexServerCall<any>("/session-packs/create", {
        userId: resolvedUserId,
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
          userId: resolvedUserId,
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
      return await convexServerCall<any>("/workspaces/ensure-admin-student", { studentUserId: resolvedUserId });
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

    const inventoryType = product.mentorshipType === "group" ? "group" : "oneOnOne";
    await step.run("decrement-inventory", async () => {
      if (!product.instructorId) {
        throw new Error(`Product has no instructorId: ${packId}`);
      }
      await convexServerCall<any>("/inventory/decrement", {
        instructorId: product.instructorId as Id<"instructors">,
        type: inventoryType,
      });
    });

    const sessionsCount = product.sessionsPerPack || 0;
    const pricePaid = fullSession.amount_total ? (fullSession.amount_total / 100).toFixed(2) : null;
    const currency = fullSession.currency?.toUpperCase() || "USD";

    // Post-purchase confirmation email (Resend) for ALL purchasers with an email address
    await step.run("send-purchase-confirmation-email", async () => {
      // Prefer Stripe's customer_details.email as the authoritative source; fall back to webhook event data
      const email = (fullSession.customer_details?.email || studentEmail || "").trim().toLowerCase();
      if (!email) return { skipped: true } as const;

      const baseUrl = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

      // Check if a Clerk user already exists for this email address
      const existingClerkUserId = await findClerkUserIdByEmail(email);

      // Determine the userId to use for magic link: prefer resolved userId, fallback to existing Clerk user
      const isClerkUser = resolvedUserId !== "guest" && !resolvedUserId.startsWith("email:");
      const clerkUserIdForMagicLink = isClerkUser ? resolvedUserId : existingClerkUserId;

      // Only send magic link when a Clerk account exists
      let magicLinkSent = false;
      if (clerkUserIdForMagicLink) {
        const magicLinkRedirectUrl = `${baseUrl}/sign-in`;
        const magicLinkResult = await sendEmailLinkForUser(clerkUserIdForMagicLink, magicLinkRedirectUrl);
        magicLinkSent = magicLinkResult.ok;
        await reportInfo({
          source: "inngest:process-stripe-checkout",
          message: magicLinkResult.ok ? "Magic link sent" : `Magic link failed: ${magicLinkResult.error}`,
          level: magicLinkResult.ok ? "info" : "warn",
          context: { orderId, ok: magicLinkSent, hasExistingClerkAccount: !!existingClerkUserId },
        });
      } else {
        await reportInfo({
          source: "inngest:process-stripe-checkout",
          message: "No Clerk account found via email lookup, sending sign-in email",
          level: "info",
          context: { orderId },
        });
      }

      // Branch on magicLinkSent: Clerk user who received a magic link gets the
      // "check your inbox" template; guests get the "your account is ready" template.
      // Note: Even when email lookup fails, a Clerk account was created at checkout time,
      // so we always send the "account ready" template with sign-in button.
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
            <h2 style="margin:0 0 12px">Your account is ready</h2>
            <p style="margin:0 0 16px">Thank you for your purchase! Your account has been created. Click the button below to sign in and access your dashboard to start booking sessions.</p>
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
            <p style="margin:8px 0 0;font-size:14px">Need help accessing your account? <a href="${baseUrl}/sign-in">Sign in here</a></p>
          </div>`;

      const res = await sendEmail({
        to: email,
        subject: magicLinkSent
          ? "Your mentorship purchase is confirmed — Check your email for your login link"
          : "Your mentorship purchase is confirmed",
        html,
        headers: { "X-Email-Type": magicLinkSent ? "purchase_confirmation" : "guest_onboarding", "X-Order-Id": orderId, "X-Provider": "stripe" },
      });

      const parsedResult = parseEmailResult(res);
      await reportInfo({
        source: "inngest:process-stripe-checkout",
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
          clerkId: resolvedUserId,
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
