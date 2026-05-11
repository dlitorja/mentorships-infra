type RefundEmailArgs = {
  studentName: string | null;
  instructorName: string;
  refundAmount: string;
  currency: string;
  reason: string;
  customReason: string | null;
  dashboardUrl: string;
  provider: "stripe" | "paypal";
  providerReference: string | null;
};

export type RefundEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export function buildRefundEmail(args: RefundEmailArgs): RefundEmail {
  const subject = `Refund processed — ${args.instructorName} mentorship`;

  const greetingName = args.studentName?.trim() ? args.studentName.trim() : "there";

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: args.currency.toUpperCase(),
  }).format(parseFloat(args.refundAmount));

  const reasonText = args.reason === "Other" && args.customReason
    ? args.customReason
    : args.reason;

  const providerName = args.provider === "stripe" ? "Stripe" : "PayPal";
  const providerReferenceText = args.providerReference
    ? ` (Reference: ${args.providerReference})`
    : "";

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
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Refund Processed</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Your payment of <strong>${formattedAmount}</strong> for mentorship with <strong>${escapeHtml(args.instructorName)}</strong> has been refunded.
        </div>

        <div style="margin:0 0 12px 0;color:#374151">
          <div style="font-weight:700;margin-bottom:6px">Refund Details</div>
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            <li><strong>Amount:</strong> ${formattedAmount}</li>
            <li><strong>Reason:</strong> ${escapeHtml(reasonText)}</li>
            <li><strong>Payment Method:</strong> ${providerName}${providerReferenceText}</li>
          </ul>
        </div>

        <div style="padding:12px;border:1px solid #FEF3C7;border-radius:10px;background:#FFFBEB;margin-bottom:12px">
          <div style="font-weight:800;margin-bottom:6px">Refund Timeline</div>
          <div style="color:#374151;line-height:1.6">
            Please allow 5-10 business days for the refund to appear in your account.
          </div>
        </div>

        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If you have any questions, reply to this email or email <a href="mailto:support@huckleberry.art">support@huckleberry.art</a>.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "refund",
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}