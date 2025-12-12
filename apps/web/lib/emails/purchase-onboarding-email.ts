type PurchaseOnboardingEmailArgs = {
  studentName: string | null;
  instructorName: string;
  dashboardUrl: string;
  onboardingUrl: string;
  discordConnected: boolean;
  discordServerInviteUrl: string | null;
};

export type PurchaseOnboardingEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export function buildPurchaseOnboardingEmail(args: PurchaseOnboardingEmailArgs): PurchaseOnboardingEmail {
  const subject = `Welcome — your mentorship with ${args.instructorName} is ready`;

  const greetingName = args.studentName?.trim() ? args.studentName.trim() : "there";

  const shouldShowConnectDiscordCopy = args.discordConnected === false;
  const discordInviteLine = args.discordServerInviteUrl
    ? `Join the Discord server: ${args.discordServerInviteUrl}`
    : null;

  const text = [
    `Hi ${greetingName},`,
    "",
    `Thanks for purchasing mentorship. Your instructor: ${args.instructorName}`,
    "",
    "Next steps:",
    `- Open your Dashboard: ${args.dashboardUrl}`,
    `- Complete onboarding (share your goals for this mentorship + add 2-4 current artwork pieces): ${args.onboardingUrl}`,
    "",
    "Important — join Discord:",
    ...(shouldShowConnectDiscordCopy
      ? [
          "Please connect your Discord account in your Dashboard so we can assign your mentee role and unlock access to the mentorship Discord channels.",
        ]
      : []),
    "Join the Discord server so you can access the mentorship Discord channels.",
    ...(discordInviteLine ? [discordInviteLine] : []),
    "",
    "If you need any assistance, reply to this email or email support@huckleberry.art",
  ].join("\n");

  const discordHtml = `
    <div style="padding:12px;border:1px solid #E5E7EB;border-radius:10px;background:#FEF3C7;margin-bottom:12px">
      <div style="font-weight:800;margin-bottom:6px">Important — join Discord</div>
      ${
        shouldShowConnectDiscordCopy
          ? `<div style="color:#374151;line-height:1.6;margin-bottom:10px">
               Please connect your Discord account in your Dashboard so we can assign your mentee role and unlock access to the mentorship Discord channels.
             </div>`
          : `<div style="color:#374151;line-height:1.6;margin-bottom:10px">
               Join the Discord server so you can access the mentorship Discord channels.
             </div>`
      }
      ${
        args.discordServerInviteUrl
          ? `<div style="margin-top:0px">
               <a href="${args.discordServerInviteUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">Join the Discord server</a>
             </div>`
          : ""
      }
    </div>
  `.trim();

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Welcome, ${escapeHtml(greetingName)}</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Thanks for purchasing mentorship. Your instructor: <strong>${escapeHtml(args.instructorName)}</strong>
        </div>

        <div style="margin:0 0 12px 0;color:#374151">
          <div style="font-weight:700;margin-bottom:6px">Next steps</div>
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            <li><a href="${args.dashboardUrl}">Open your Dashboard</a></li>
            <li><a href="${args.onboardingUrl}">Complete onboarding</a> (share your goals for this mentorship + add 2-4 current artwork pieces)</li>
          </ul>
        </div>

        ${discordHtml}

        <a href="${args.onboardingUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Complete onboarding</a>

        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button doesn’t work, copy/paste this link:<br/>
          <div>${escapeHtml(args.onboardingUrl)}</div>
        </p>

        <p style="margin:12px 0 0 0;color:#6B7280;font-size:12px">
          If you need any assistance, reply to this email or email <a href="mailto:support@huckleberry.art">support@huckleberry.art</a>.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "purchase_onboarding",
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


