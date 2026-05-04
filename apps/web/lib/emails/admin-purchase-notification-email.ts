type AdminPurchaseEmailArgs = {
  orderId: string;
  studentName: string | null;
  studentEmail: string;
  instructorName: string;
  sessionCount: number;
  purchaseAmount: string;
  currency: string;
  paymentProvider: "stripe" | "paypal";
  dashboardUrl: string;
};

export type AdminPurchaseEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

function formatCurrency(amount: string, currency: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(num);
}

export function buildAdminPurchaseEmail(args: AdminPurchaseEmailArgs): AdminPurchaseEmail {
  const subject = `New mentorship purchase - ${args.studentName || args.studentEmail} with ${args.instructorName}`;
  const greetingName = args.studentName?.trim() || args.studentEmail;

  const formattedAmount = formatCurrency(args.purchaseAmount, args.currency);
  const providerLabel = args.paymentProvider === "stripe" ? "Stripe" : "PayPal";

  const text = [
    `New mentorship purchase`,
    "",
    `Student: ${greetingName} (${args.studentEmail})`,
    `Instructor: ${args.instructorName}`,
    `Sessions: ${args.sessionCount}`,
    `Amount: ${formattedAmount}`,
    `Provider: ${providerLabel}`,
    `Order ID: ${args.orderId}`,
    "",
    `View dashboard: ${args.dashboardUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">New mentorship purchase</div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr>
            <td style="padding:8px 0;color:#6B7280;width:120px">Student</td>
            <td style="padding:8px 0;font-weight:500">${escapeHtml(greetingName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280">Email</td>
            <td style="padding:8px 0"><a href="mailto:${escapeHtml(args.studentEmail)}">${escapeHtml(args.studentEmail)}</a></td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280">Instructor</td>
            <td style="padding:8px 0;font-weight:500">${escapeHtml(args.instructorName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280">Sessions</td>
            <td style="padding:8px 0">${args.sessionCount}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280">Amount</td>
            <td style="padding:8px 0;font-weight:500">${formattedAmount}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280">Provider</td>
            <td style="padding:8px 0">${providerLabel}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6B7280">Order ID</td>
            <td style="padding:8px 0;font-family:monospace">${escapeHtml(args.orderId)}</td>
          </tr>
        </table>

        <a href="${escapeHtml(args.dashboardUrl)}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Dashboard</a>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "admin_purchase_notification",
      "X-Order-Id": args.orderId,
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