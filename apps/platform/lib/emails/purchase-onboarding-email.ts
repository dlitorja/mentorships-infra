type InstructorRow = {
  instructorName: string;
  workspaceUrl: string;
};

type PurchaseOnboardingEmailArgs = {
  studentName: string | null;
  instructorName: string;
  dashboardUrl: string;
  onboardingUrl: string;
  discordConnected: boolean;
  discordServerInviteUrl: string | null;
  /** PR 3: admin-onboarded context */
  isAdminOnboarded?: boolean;
  /** PR 3: true when every selected pair is a renewal */
  isRenewal?: boolean;
  /** PR 3: total instructor count for multi-pair admin onboardings */
  instructorCount?: number;
  /** PR 3: full instructor list when isAdminOnboarded && instructorCount > 1 */
  instructorList?: InstructorRow[];
};

export type PurchaseOnboardingEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export function buildPurchaseOnboardingEmail(args: PurchaseOnboardingEmailArgs): PurchaseOnboardingEmail {
  const isAllRenewal = args.isRenewal === true;
  const isMultiInstructor = (args.instructorCount ?? 1) > 1;

  const subject = isAllRenewal
    ? "Welcome back — your mentorship" + (isMultiInstructor ? "s" : "") + " with " + args.instructorName + (isMultiInstructor ? " + " + ((args.instructorCount ?? 1) - 1) + " other" + (((args.instructorCount ?? 1) - 1) === 1 ? "" : "s") : "") + " is ready"
    : "Welcome — your mentorship" + (isMultiInstructor ? "s" : "") + " with " + args.instructorName + (isMultiInstructor ? " + " + ((args.instructorCount ?? 1) - 1) + " other" + (((args.instructorCount ?? 1) - 1) === 1 ? "" : "s") : "") + " " + (isAllRenewal ? "are" : "is") + " ready";

  const greetingName = args.studentName?.trim() ? args.studentName.trim() : "there";

  const shouldShowConnectDiscordCopy = args.discordConnected === false;
  const discordInviteLine = args.discordServerInviteUrl
    ? `Join the Discord server: ${args.discordServerInviteUrl}`
    : null;

  const textLines: string[] = [
    "Hi " + greetingName + ",",
    "",
  ];
  if (args.isAdminOnboarded) {
    textLines.push("You have been assigned to mentorship workspace" + (isMultiInstructor ? "s" : "") + " at Huckleberry.");
  } else {
    textLines.push("Thanks for purchasing mentorship. Your instructor" + (isMultiInstructor ? "s" : "") + ":");
    if (!isMultiInstructor) {
      textLines.push("  \u2022 " + args.instructorName);
    }
  }
  if (isMultiInstructor && args.instructorList) {
    for (const row of args.instructorList) {
      textLines.push("  \u2022 " + row.instructorName + ": " + row.workspaceUrl);
    }
  }
  textLines.push("");
  textLines.push("Next steps:");
  textLines.push("- Open your Dashboard: " + args.dashboardUrl);
  textLines.push("- Complete onboarding (share your goals for this mentorship + add 2-4 current artwork pieces): " + args.onboardingUrl);
  textLines.push("");
  textLines.push("Important — join Discord:");
  if (shouldShowConnectDiscordCopy) {
    textLines.push("Please connect your Discord account in your Dashboard so we can assign your student role and unlock access to the mentorship Discord channels.");
  }
  textLines.push("Join the Discord server so you can access the mentorship Discord channels.");
  if (discordInviteLine) textLines.push(discordInviteLine);
  textLines.push("");
  textLines.push("If you need any assistance, reply to this email or email support@huckleberry.art");

  const text = textLines.join("\n");

  const discordHtml = `
    <div style="padding:12px;border:1px solid #E5E7EB;border-radius:10px;background:#FEF3C7;margin-bottom:12px">
      <div style="font-weight:800;margin-bottom:6px">Important — join Discord</div>
      ${
        shouldShowConnectDiscordCopy
           ? `<div style="color:#374151;line-height:1.6;margin-bottom:10px">
               Please connect your Discord account in your Dashboard so we can assign your student role and unlock access to the mentorship Discord channels.
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

  const introLine = args.isAdminOnboarded
    ? "You have been assigned to mentorship workspace" + (isMultiInstructor ? "s" : "") + " at Huckleberry."
    : "Thanks for purchasing mentorship. Your instructor" + (isMultiInstructor ? "s" : "") + ":";

  const instructorTableHtml = isMultiInstructor && args.instructorList && args.instructorList.length > 0
    ? "<div style=\"margin:0 0 16px 0;color:#374151\"><div style=\"font-weight:700;margin-bottom:8px\">Your Workspaces</div><table style=\"width:100%;border-collapse:collapse;margin-bottom:8px\"><thead><tr style=\"border-bottom:1px solid #E5E7EB\"><th style=\"text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500\">Instructor</th><th style=\"text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500\">Workspace</th></tr></thead><tbody>" +
      args.instructorList.map(function(row) {
        return "<tr style=\"border-bottom:1px solid #F3F4F6\"><td style=\"padding:6px 8px;font-weight:500\">" + escapeHtml(row.instructorName) + "</td><td style=\"padding:6px 8px\"><a href=\"" + escapeHtml(row.workspaceUrl) + "\">Open workspace</a></td></tr>";
      }).join("") +
      "</tbody></table></div>"
    : "";

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Welcome, ${escapeHtml(greetingName)}</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          ${introLine}
        </div>

        ${instructorTableHtml}

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
      "X-Email-Type": args.isAdminOnboarded ? "admin_onboarding_student" : "purchase_onboarding",
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

