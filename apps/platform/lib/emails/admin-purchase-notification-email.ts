type PerInstructorEmailRow = {
  instructorName: string;
  isRenewal: boolean;
  workspaceUrl: string;
  sessionsCount: number;
  expirationDate?: string;
  clerkInvitationId?: string;
};

type AdminPurchaseEmailArgs = {
  orderId?: string;
  studentName: string | null;
  studentEmail: string;
  instructorName: string;
  sessionCount: number;
  purchaseAmount?: string;
  currency?: string;
  paymentProvider?: "stripe" | "paypal";
  dashboardUrl: string;
  /** PR 3: admin-onboarded context (no purchase order) */
  isAdminOnboarded?: boolean;
  /** PR 3: total instructor count for multi-pair onboardings */
  instructorCount?: number;
  /** PR 3: per-instructor rows for multi-pair admin onboardings */
  perInstructorRows?: PerInstructorEmailRow[];
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
  const isMultiInstructor = (args.instructorCount ?? 1) > 1;
  const perInstructorRows = args.perInstructorRows ?? [];

  const subjectPrefix = args.isAdminOnboarded ? "[Admin Onboarding] " : "";
  const subject = subjectPrefix + (args.isAdminOnboarded
    ? "Kajabi admin onboarding — " + args.studentEmail + " × " + (args.instructorCount ?? 1) + " instructor" + ((args.instructorCount ?? 1) > 1 ? "s" : "")
    : "New session pack purchase - " + (args.studentName || args.studentEmail) + " with " + args.instructorName);

  const greetingName = args.studentName?.trim() || args.studentEmail;

  const formattedAmount = args.purchaseAmount ? formatCurrency(args.purchaseAmount, args.currency ?? "USD") : "N/A";
  const providerLabel = args.paymentProvider === "stripe" ? "Stripe" : args.paymentProvider === "paypal" ? "PayPal" : null;

  const textParts: string[] = [];
  if (args.isAdminOnboarded) {
    textParts.push("Kajabi admin onboarding completed");
    textParts.push("");
    textParts.push("Student: " + greetingName + " (" + args.studentEmail + ")");
    textParts.push("Instructors: " + (args.instructorCount ?? 1));
    textParts.push("");
    for (const row of perInstructorRows) {
      textParts.push("  " + String.fromCharCode(8226) + " " + row.instructorName + " | " + (row.isRenewal ? "Renewal" : "New workspace") + " | " + row.workspaceUrl + " | " + row.sessionsCount + " session" + (row.sessionsCount !== 1 ? "s" : ""));
    }
    textParts.push("");
    textParts.push("View onboardings dashboard: " + args.dashboardUrl);
  } else {
    textParts.push("New session pack purchase");
    textParts.push("");
    textParts.push("Student: " + greetingName + " (" + args.studentEmail + ")");
    textParts.push("Instructor: " + args.instructorName);
    textParts.push("Sessions: " + args.sessionCount);
    if (formattedAmount !== "N/A") {
      textParts.push("Amount: " + formattedAmount);
    }
    if (providerLabel) {
      textParts.push("Provider: " + providerLabel);
    }
    if (args.orderId) {
      textParts.push("Order ID: " + args.orderId);
    }
    textParts.push("");
    textParts.push("View dashboard: " + args.dashboardUrl);
  }
  const text = textParts.join("\n");

  const htmlIntro = args.isAdminOnboarded
    ? "Kajabi admin onboarding completed"
    : "New session pack purchase";

  const adminOnboardingTableHtml = isMultiInstructor && perInstructorRows.length > 0
    ? "<table style=\"width:100%;border-collapse:collapse;margin-bottom:16px\">" +
      "<thead><tr style=\"border-bottom:2px solid #E5E7EB\">" +
      "<th style=\"text-align:left;padding:8px 8px;color:#6B7280;font-size:12px;font-weight:500\">Instructor</th>" +
      "<th style=\"text-align:left;padding:8px 8px;color:#6B7280;font-size:12px;font-weight:500\">Type</th>" +
      "<th style=\"text-align:left;padding:8px 8px;color:#6B7280;font-size:12px;font-weight:500\">Sessions</th>" +
      "<th style=\"text-align:left;padding:8px 8px;color:#6B7280;font-size:12px;font-weight:500\">Expiration</th>" +
      "<th style=\"text-align:left;padding:8px 8px;color:#6B7280;font-size:12px;font-weight:500\">Workspace</th>" +
      "</tr></thead><tbody>" +
      perInstructorRows.map(function(row) {
        return "<tr>" +
          "<td style=\"padding:8px 8px;font-weight:500\">" + escapeHtml(row.instructorName) + "</td>" +
          "<td style=\"padding:8px 8px\"><span style=\"display:inline-block;padding:2px 8px;background:" + (row.isRenewal ? "#DBEAFE" : "#D1FAE5") + ";color:" + (row.isRenewal ? "#1E40AF" : "#065F46") + ";border-radius:9999px;font-size:12px;font-weight:500\">" + (row.isRenewal ? "Renewal" : "New") + "</span></td>" +
          "<td style=\"padding:8px 8px\">" + row.sessionsCount + "</td>" +
          "<td style=\"padding:8px 8px\">" + (row.expirationDate ?? "—") + "</td>" +
          "<td style=\"padding:8px 8px\"><a href=\"" + escapeHtml(row.workspaceUrl) + "\">Open workspace</a></td>" +
          "</tr>";
      }).join("") +
      "</tbody></table>"
    : "";

  const adminOnboardingMetaHtml = args.isAdminOnboarded
    ? "<tr><td style=\"padding:8px 0;color:#6B7280;width:120px\">Student</td><td style=\"padding:8px 0;font-weight:500\">" + escapeHtml(greetingName) + "</td></tr>" +
      "<tr><td style=\"padding:8px 0;color:#6B7280\">Email</td><td style=\"padding:8px 0\"><a href=\"mailto:" + escapeHtml(args.studentEmail) + "\">" + escapeHtml(args.studentEmail) + "</a></td></tr>" +
      "<tr><td style=\"padding:8px 0;color:#6B7280\">Instructors</td><td style=\"padding:8px 0;font-weight:500\">" + (args.instructorCount ?? 1) + "</td></tr>"
    : "<tr><td style=\"padding:8px 0;color:#6B7280;width:120px\">Student</td><td style=\"padding:8px 0;font-weight:500\">" + escapeHtml(greetingName) + "</td></tr>" +
      "<tr><td style=\"padding:8px 0;color:#6B7280\">Email</td><td style=\"padding:8px 0\"><a href=\"mailto:" + escapeHtml(args.studentEmail) + "\">" + escapeHtml(args.studentEmail) + "</a></td></tr>" +
      "<tr><td style=\"padding:8px 0;color:#6B7280\">Instructor</td><td style=\"padding:8px 0;font-weight:500\">" + escapeHtml(args.instructorName) + "</td></tr>" +
      "<tr><td style=\"padding:8px 0;color:#6B7280\">Sessions</td><td style=\"padding:8px 0\">" + args.sessionCount + "</td></tr>" +
      (formattedAmount !== "N/A" ? "<tr><td style=\"padding:8px 0;color:#6B7280\">Amount</td><td style=\"padding:8px 0;font-weight:500\">" + formattedAmount + "</td></tr>" : "") +
      (providerLabel ? "<tr><td style=\"padding:8px 0;color:#6B7280\">Provider</td><td style=\"padding:8px 0\">" + providerLabel + "</td></tr>" : "") +
      (args.orderId ? "<tr><td style=\"padding:8px 0;color:#6B7280\">Order ID</td><td style=\"padding:8px 0;font-family:monospace\">" + escapeHtml(args.orderId) + "</td></tr>" : "");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">` + htmlIntro + `</div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">` +
          adminOnboardingMetaHtml +
        `</table>` +
        adminOnboardingTableHtml +
        `<a href="${escapeHtml(args.dashboardUrl)}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">` + (args.isAdminOnboarded ? "View Onboardings" : "View Dashboard") + `</a>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": args.isAdminOnboarded ? "admin_onboarding_summary" : "admin_purchase_notification",
      ...(args.orderId ? { "X-Order-Id": args.orderId } : {}),
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