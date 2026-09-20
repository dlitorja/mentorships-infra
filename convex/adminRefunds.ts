"use node";

import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

const REFUND_REASONS = [
  "Duplicate",
  "Fraudulent",
  "Requested by customer",
  "Other",
] as const;
type RefundReason = (typeof REFUND_REASONS)[number];

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const PAYPAL_API_BASE_SANDBOX = "https://api-m.sandbox.paypal.com";
const PAYPAL_API_BASE_LIVE = "https://api-m.paypal.com";

function paypalBase(): string {
  return process.env.PAYPAL_ENV === "live" ? PAYPAL_API_BASE_LIVE : PAYPAL_API_BASE_SANDBOX;
}

function stripeReason(reason: RefundReason): "duplicate" | "fraudulent" | "requested_by_customer" {
  switch (reason) {
    case "Fraudulent":
      return "fraudulent";
    case "Duplicate":
      return "duplicate";
    default:
      return "requested_by_customer";
  }
}

async function stripeRefund(args: {
  paymentIntentId: string;
  amountCents: number;
  reason: RefundReason;
  idempotencyKey: string;
}): Promise<string> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new ConvexError({
      code: "STRIPE_NOT_CONFIGURED",
      message: "STRIPE_SECRET_KEY is not set; cannot process Stripe refund",
    });
  }

  const body = new URLSearchParams();
  body.set("payment_intent", args.paymentIntentId);
  body.set("amount", String(args.amountCents));
  body.set("reason", stripeReason(args.reason));

  const res = await fetch(`${STRIPE_API_BASE}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": args.idempotencyKey,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ConvexError({
      code: "STRIPE_REFUND_FAILED",
      message: `Stripe refund failed (${res.status}): ${text.slice(0, 500)}`,
    });
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? "";
}

async function paypalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    throw new ConvexError({
      code: "PAYPAL_NOT_CONFIGURED",
      message: "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set",
    });
  }
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ConvexError({
      code: "PAYPAL_AUTH_FAILED",
      message: `PayPal token request failed (${res.status}): ${text.slice(0, 500)}`,
    });
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new ConvexError({
      code: "PAYPAL_AUTH_FAILED",
      message: "PayPal returned no access_token",
    });
  }
  return data.access_token;
}

async function paypalRefund(args: {
  captureId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
  note?: string;
}): Promise<string> {
  const token = await paypalAccessToken();
  const body = {
    amount: {
      value: args.amount,
      currency_code: args.currency.toUpperCase(),
    },
    ...(args.note ? { note_to_payer: args.note } : {}),
  };
  const res = await fetch(
    `${paypalBase()}/v2/payments/captures/${encodeURIComponent(args.captureId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": args.idempotencyKey,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ConvexError({
      code: "PAYPAL_REFUND_FAILED",
      message: `PayPal refund failed (${res.status}): ${text.slice(0, 500)}`,
    });
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendRefundEmail(args: {
  to: string;
  studentName: string | null;
  instructorName: string;
  refundAmount: string;
  currency: string;
  reason: RefundReason;
  customReason: string | null;
  provider: "stripe" | "paypal";
  providerReference: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new ConvexError({
        code: "EMAIL_NOT_CONFIGURED",
        message: "RESEND_API_KEY not set in production",
      });
    }
    return;
  }

  const fromEnv = process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM ?? "noreply@huckleberry.art";
  const dashboardUrl = process.env.NEXT_PUBLIC_URL
    ? `${process.env.NEXT_PUBLIC_URL}/dashboard`
    : "https://huckleberry.art/dashboard";

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: args.currency.toUpperCase(),
  }).format(parseFloat(args.refundAmount));

  const reasonText = args.reason === "Other" && args.customReason ? args.customReason : args.reason;
  const providerName = args.provider === "stripe" ? "Stripe" : "PayPal";
  const providerReferenceText = args.providerReference ? ` (Reference: ${args.providerReference})` : "";
  const greetingName = args.studentName?.trim() ? args.studentName.trim() : "there";

  const subject = `Refund processed — ${escapeHtml(args.instructorName)} mentorship`;
  const text = [
    `Hi ${greetingName},`,
    "",
    `Your payment of ${formattedAmount} for mentorship with ${args.instructorName} has been refunded.`,
    "",
    `Reason: ${reasonText}`,
    "",
    `The refund has been processed to your original payment method.`,
    `Please allow 5-10 business days for the refund to appear in your account.`,
    "",
    `If you have any questions, reply to this email or contact support@huckleberry.art.`,
    `Dashboard: ${dashboardUrl}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
    <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
      <div style="font-weight:700;margin-bottom:6px">Refund Processed</div>
      <p style="color:#374151;line-height:1.6">Your payment of <strong>${formattedAmount}</strong> for mentorship with <strong>${escapeHtml(args.instructorName)}</strong> has been refunded.</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7">
        <li><strong>Amount:</strong> ${formattedAmount}</li>
        <li><strong>Reason:</strong> ${escapeHtml(reasonText)}</li>
        <li><strong>Payment Method:</strong> ${escapeHtml(providerName)}${providerReferenceText ? ` (Reference: ${escapeHtml(providerReferenceText)})` : ""}</li>
      </ul>
      <div style="padding:12px;border:1px solid #FEF3C7;border-radius:10px;background:#FFFBEB;margin-top:12px">
        <strong>Refund Timeline</strong>
        <p style="color:#374151;line-height:1.6;margin:0">Please allow 5-10 business days for the refund to appear in your account.</p>
      </div>
    </div>
  </body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEnv,
      to: [args.to],
      subject,
      html,
      text,
      headers: { "X-Email-Type": "refund" },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ConvexError({
      code: "RESEND_FAILED",
      message: `Resend failed (${res.status}): ${errText.slice(0, 500)}`,
    });
  }
}

/**
 * Admin-only action that processes a full or partial refund for a
 * payment, updates the underlying payment + order, and sends the
 * student a refund notification email.
 *
 * Replaces the marketing-orphaned `apps/platform/app/api/admin/refunds`
 * flow for marketing-admin consumers. The platform + web admin API
 * routes are unchanged and still call `api.payments.adminProcessRefund`
 * + their own Stripe/PayPal/email code.
 *
 * Steps:
 *  1. Admin gate via `internal.admin.isAdmin` (the action can't read
 *     `ctx.db` directly; it round-trips through this internal query).
 *  2. Load payment via `internal.payments.getPaymentByIdInternal`.
 *  3. Validate (not already refunded, not failed) and compute the
 *     refund amount (full vs partial, clamped to remaining refundable).
 *  4. Call Stripe or PayPal refund API with an idempotency key so
 *     retries don't double-refund.
 *  5. Call `internal.payments.adminProcessRefundInternal` to apply
 *     the DB updates (status flips, audit log).
 *  6. Send refund email via Resend.
 *
 * The Stripe / PayPal / Resend calls happen here (not in the DB
 * mutation) because actions can use `"use node"` for outbound HTTP.
 */
export const processRefundForAdmin = action({
  args: {
    paymentId: v.id("payments"),
    refundType: v.union(v.literal("full"), v.literal("partial")),
    amount: v.optional(v.string()),
    reason: v.union(
      v.literal("Duplicate"),
      v.literal("Fraudulent"),
      v.literal("Requested by customer"),
      v.literal("Other")
    ),
    customReason: v.optional(v.string()),
    /**
     * Client-supplied idempotency nonce. The refund modal generates a
     * UUID when it opens and reuses it across retries, so if the action
     * throws after the provider accepted the refund but before the local
     * DB update committed, a retry from the same modal dedupes at the
     * provider and doesn't double-refund the customer. Different modals
     * (different admins, or the same admin reopening the refund dialog)
     * generate different nonces, so legitimate concurrent partial
     * refunds of the same dollar amount still proceed as separate
     * provider operations.
     */
    nonce: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    message: string;
    refund: {
      paymentId: Id<"payments">;
      amount: string;
      currency: string;
      type: "full" | "partial";
      reason: "Duplicate" | "Fraudulent" | "Requested by customer" | "Other";
      customReason: string | null;
      providerRefundId: string | null;
      provider: "stripe" | "paypal";
    };
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Not authenticated" });
    }
    const admin = await ctx.runQuery(internal.admin.isAdmin, {
      subject: identity.subject,
    });
    if (!admin) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin role required" });
    }

    const payment = await ctx.runQuery(internal.payments.getPaymentByIdInternal, {
      id: args.paymentId,
    });
    if (!payment) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Payment not found" });
    }
    if (payment.status === "refunded") {
      throw new ConvexError({
        code: "ALREADY_REFUNDED",
        message: "Payment has already been refunded",
      });
    }
    if (payment.status === "failed") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Cannot refund a failed payment",
      });
    }

    const originalAmount = parseFloat(payment.amount);
    const priorRefunded = payment.refundedAmount ? parseFloat(payment.refundedAmount) : 0;

    let refundAmount: number;
    if (args.refundType === "partial") {
      if (!args.amount) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Amount is required for partial refunds",
        });
      }
      refundAmount = parseFloat(args.amount);
      const remaining = originalAmount - priorRefunded;
      if (refundAmount > remaining) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: `Refund amount exceeds remaining refundable amount (${remaining.toFixed(2)})`,
        });
      }
    } else {
      refundAmount = originalAmount - priorRefunded;
    }

    if (refundAmount <= 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Invalid refund amount",
      });
    }

    const refundAmountStr = refundAmount.toFixed(2);
    const currency = payment.currency || "usd";

    // Idempotency: include the client-supplied nonce so retries from the
    // same modal share a provider key (dedupe = no double refund) while
    // legitimate concurrent partial refunds of the same dollar amount
    // from different modals each get a distinct key.
    const idempotencyKey = `refund:${args.paymentId}:${args.refundType}:${refundAmountStr}:${priorRefunded.toFixed(2)}:${args.nonce}`;

    // Durable audit trail BEFORE the provider call so that, if the
    // post-call mutation fails (network drop, Convex outage, etc), an
    // operator has a recoverable record of the attempt and can reconcile
    // the payment/order status manually. The complementary `completed`
    // entry is written by `adminProcessRefundInternal` after the DB
    // mutation succeeds.
    await ctx.runMutation(internal.auditLog.recordAuditLog, {
      actorId: identity.subject,
      actorRole: "admin",
      action: "admin_refund_attempted",
      targetType: "payment",
      targetId: args.paymentId,
      details: `Attempting ${args.refundType} refund of ${refundAmountStr} ${currency.toUpperCase()} via ${payment.provider}`,
      metadata: {
        orderId: payment.orderId,
        refundType: args.refundType,
        refundAmount: refundAmountStr,
        currency: currency.toUpperCase(),
        provider: payment.provider,
        priorRefunded: priorRefunded.toFixed(2),
        idempotencyKey,
      },
    });

    let providerRefundId: string | null = null;

    if (payment.provider === "stripe") {
      providerRefundId = await stripeRefund({
        paymentIntentId: payment.providerPaymentId,
        amountCents: Math.round(refundAmount * 100),
        reason: args.reason,
        idempotencyKey,
      });
    } else if (payment.provider === "paypal") {
      providerRefundId = await paypalRefund({
        captureId: payment.providerPaymentId,
        amount: refundAmountStr,
        currency: currency.toUpperCase(),
        idempotencyKey,
        note:
          args.reason === "Other" && args.customReason
            ? args.customReason
            : args.reason,
      });
    } else {
      throw new ConvexError({
        code: "UNSUPPORTED_PROVIDER",
        message: `Unsupported payment provider: ${String(payment.provider)}`,
      });
    }

    await ctx.runMutation(internal.payments.adminProcessRefundInternal, {
      paymentId: args.paymentId,
      refundAmount: refundAmountStr,
    });

    // Email is best-effort — log and continue on failure so a mail
    // outage doesn't block the admin from completing the refund.
    try {
      const order = await ctx.runQuery(internal.orders.getOrderByIdInternal, {
        id: payment.orderId as Id<"orders">,
      });
      if (order) {
        const user = await ctx.runQuery(api.users.getUserByUserId, {
          userId: order.userId,
        });
        if (user?.email) {
          await sendRefundEmail({
            to: user.email,
            studentName: user.firstName ?? user.email,
            instructorName: "Your Instructor",
            refundAmount: refundAmountStr,
            currency,
            reason: args.reason,
            customReason: args.customReason ?? null,
            provider: payment.provider,
            providerReference: providerRefundId,
          });
        }
      }
    } catch (emailErr) {
      console.error("Failed to send refund email:", emailErr);
    }

    return {
      success: true,
      message: "Refund processed successfully",
      refund: {
        paymentId: args.paymentId,
        amount: refundAmountStr,
        currency,
        type: args.refundType,
        reason: args.reason,
        customReason: args.customReason ?? null,
        providerRefundId,
        provider: payment.provider,
      },
    };
  },
});
