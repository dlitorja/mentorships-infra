import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../convex/_generated/dataModel";
import { stripe } from "../../lib/stripe";
import { sendEmail } from "@/lib/email";
import { reportInfo } from "@/lib/observability";
import { sendEmailLinkForUser } from "@/lib/clerk-magic-links";
import { z } from "zod";
import type { PaypalPaymentCompletedEvent } from "../types";

const clerkUserSchema = z.array(
  z.object({
    id: z.string(),
    email_addresses: z.array(
      z.object({
        email_address: z.string(),
      })
    ),
  })
);

type ClerkUser = z.infer<typeof clerkUserSchema>[number];

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_DEPLOYMENT_URL is not set");
  }
  return url;
}

function getConvexHttpKey(): string {
  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new Error("CONVEX_HTTP_KEY is not set");
  }
  return key;
}

async function convexQuery<T>(queryName: string, args: Record<string, unknown>): Promise<T> {
  const url = getConvexUrl();
  const key = getConvexHttpKey();
  const res = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ path: queryName, args, format: "json" }),
  });
  if (!res.ok) {
    throw new Error(`Convex query ${queryName} failed: ${res.status}`);
  }
  const json = await res.json() as { status: string; value: T; errorMessage?: string };
  if (json.status === "error") {
    throw new Error(`Convex query ${queryName} failed: ${json.errorMessage}`);
  }
  return json.value;
}

async function convexMutation<T>(mutationName: string, args: Record<string, unknown>): Promise<T> {
  const url = getConvexUrl();
  const key = getConvexHttpKey();
  const res = await fetch(`${url}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ path: mutationName, args, format: "json" }),
  });
  if (!res.ok) {
    throw new Error(`Convex mutation ${mutationName} failed: ${res.status}`);
  }
  const json = await res.json() as { status: string; value: T; errorMessage?: string };
  if (json.status === "error") {
    throw new Error(`Convex mutation ${mutationName} failed: ${json.errorMessage}`);
  }
  return json.value;
}

async function getInstructorNameFromClerk(instructorId: Id<"instructors">, fallbackName: string): Promise<string> {
  try {
    const instructorName = await convexQuery<string | null>(
      "instructors/getInstructorNameById",
      { id: instructorId }
    );
    if (!instructorName) {
      return fallbackName;
    }
    return instructorName;
  } catch {
    return fallbackName;
  }
}

async function findClerkUserIdByEmail(email: string): Promise<string | null> {
  try {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      return null;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const queryParams = new URLSearchParams({ 'email_address': normalizedEmail });
    const response = await fetch(`https://api.clerk.com/v1/users?${queryParams}`, {
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const parseResult = clerkUserSchema.safeParse(json);
    if (!parseResult.success) {
      return null;
    }
    const users: ClerkUser[] = parseResult.data;
    const user = users.find(u => 
      u.email_addresses.some(addr => addr.email_address.toLowerCase() === normalizedEmail)
    );
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type EmailResult = { id: string | null; ok: boolean };

function parseEmailResult(res: { ok: true; id: string | null } | { ok: false; skipped?: true; error?: string }): EmailResult {
  if (res.ok) {
    return { ok: true, id: res.id ?? null };
  }
  return { ok: false, id: null };
}

function formatPrice(amount: string | null, currency: string): string {
  if (amount === null || amount === undefined) return "N/A";
  return `${currency} ${amount}`;
}

export const processStripeCheckout = inngest.createFunction(
  { id: "process-stripe-checkout", name: "Process Stripe Checkout", retries: 3 },
  { event: "stripe/checkout.session.completed" },
  async ({ event, step }) => {
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
        foundOrder = await convexQuery<any>("orders/getOrderByIdPublic", {
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
      return await convexMutation<any>("orders/completeOrder", {
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
      return await convexMutation<any>("payments/createPayment", {
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
      const productData = await convexQuery<any>("products/getPublicProductById", {
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
        await convexMutation<any>("users/createUser", {
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
      return await convexMutation<any>("sessionPacks/createSessionPack", {
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
        return await convexMutation<any>("seatReservations/createSeatReservation", {
          instructorId: product.instructorId as Id<"instructors">,
          userId: resolvedUserId,
          sessionPackId: sessionPack._id as Id<"sessionPacks">,
          seatExpiresAt: expiresAt,
          gracePeriodEndsAt: expiresAt + (7 * 24 * 60 * 60 * 1000),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          const existing = await convexQuery<any>("seatReservations/getSeatReservationBySessionPack", {
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
      await convexMutation<any>("instructors/decrementInventory", {
        id: product.instructorId as Id<"instructors">,
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
            <p style="margin:8px 0 0;font-size:14px">Didn't receive the email? Check your spam folder or <a href="${baseUrl}/sign-in">sign in</a> to resend it.</p>
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

    const payment = await step.run("get-payment", async () => {
      return await convexQuery<any>("payments/getPaymentByProviderId", {
        provider: "stripe",
        providerPaymentId: paymentIntentId,
      });
    });

    if (!payment) {
      throw new Error(`Payment not found for payment intent: ${paymentIntentId}`);
    }

    const sessionPack = await step.run("get-session-pack", async () => {
      return await convexQuery<any>("sessionPacks/getSessionPackByPaymentId", {
        paymentId: payment._id,
      });
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment._id}`);
    }

    const instructorProducts = await step.run("get-instructor-products", async () => {
      return await convexQuery<any>("products/getProductsByInstructorId", {
        instructorId: sessionPack.instructorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find((p: any) => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

const refundedSessionPack = await step.run("refund-session-pack", async () => {
      return await convexMutation<any>("sessionPacks/refundSessionPack", {
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
      await convexMutation<any>("instructors/incrementInventory", {
        id: sessionPack.instructorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    const refundedPayment = await step.run("update-payment-status", async () => {
      return await convexMutation<any>("payments/refundPayment", {
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
      return await convexMutation<any>("orders/refundOrder", {
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
    const { captureId, orderId, packId } = event.data as unknown as PaypalPaymentCompletedEvent["data"];

    const order = await step.run("get-order", async () => {
      let attempts = 0;
      let foundOrder = null;
      while (attempts < 3 && !foundOrder) {
        foundOrder = await convexQuery<any>("orders/getOrderByIdPublic", {
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
      await convexMutation<any>("orders/completeOrder", {
        id: orderId as Id<"orders">,
      });
    });

    const payment = await step.run("create-payment", async () => {
      return await convexMutation<any>("payments/createPayment", {
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
      const productData = await convexQuery<any>("products/getPublicProductById", {
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
      return await convexMutation<any>("sessionPacks/createSessionPack", {
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
        return await convexMutation<any>("seatReservations/createSeatReservation", {
          instructorId: product.instructorId as Id<"instructors">,
          userId: order.userId,
          sessionPackId: sessionPack._id as Id<"sessionPacks">,
          seatExpiresAt: expiresAt,
          gracePeriodEndsAt: expiresAt + (7 * 24 * 60 * 60 * 1000),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists")) {
          const existing = await convexQuery<any>("seatReservations/getSeatReservationBySessionPack", {
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
      await convexMutation<any>("instructors/decrementInventory", {
        id: product.instructorId as Id<"instructors">,
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

    const payment = await step.run("get-payment", async () => {
      return await convexQuery<any>("payments/getPaymentByProviderId", {
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
      return await convexQuery<any>("sessionPacks/getSessionPackByPaymentId", {
        paymentId: payment._id,
      });
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment._id}`);
    }

    const instructorProducts = await step.run("get-instructor-products", async () => {
      return await convexQuery<any>("products/getProductsByInstructorId", {
        instructorId: sessionPack.instructorId as Id<"instructors">,
      });
    });

    const product = instructorProducts.find((p: any) => p.sessionsPerPack === sessionPack.totalSessions);
    const refundInventoryType = product?.mentorshipType === "group" ? "group" : "oneOnOne";

const refundedSessionPack = await step.run("refund-session-pack", async () => {
      return await convexMutation<any>("sessionPacks/refundSessionPack", {
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
      await convexMutation<any>("instructors/incrementInventory", {
        id: sessionPack.instructorId as Id<"instructors">,
        type: refundInventoryType,
      });
    });

    const refundedPayment = await step.run("update-payment-status", async () => {
      return await convexMutation<any>("payments/refundPayment", {
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
      return await convexMutation<any>("orders/refundOrder", {
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
