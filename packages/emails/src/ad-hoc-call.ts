import { getBaseUrl } from "./send";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Builds an ad-hoc call invitation email for the student.
 *
 * Sent when an instructor starts an ad-hoc mentorship call
 * (PR #4a) and the student is offline / away from the workspace
 * UI. The email deep-links to `/workspace/{workspaceId}?join={sessionId}`
 * so a single click lands the student in the join modal.
 *
 * The instructor's name and workspace name are interpolated so
 * the email reads as a personal invite rather than a generic
 * notification. Names are escaped defensively even though the
 * inputs come from auth-gated server code paths — defense in depth
 * for the case where a future code path accepts user-supplied
 * names.
 *
 * @param args.instructorName - Display name of the instructor who started the call
 * @param args.workspaceName - Display name of the mentorship workspace
 * @param args.workspaceId - Convex workspace id, used to build the deep link
 * @param args.sessionId - Convex session id, used to build the deep link
 * @returns Email payload with subject, text, HTML, and X-Email-Type header
 */
export function buildAdHocCallInviteEmail(args: {
  instructorName: string;
  workspaceName: string;
  workspaceId: string;
  sessionId: string;
}) {
  const joinUrl = `${getBaseUrl()}/workspace/${args.workspaceId}?join=${args.sessionId}`;
  const subject = `${args.instructorName} started a mentorship call`;

  const text = [
    `${args.instructorName} has started a mentorship call in ${args.workspaceName}.`,
    "",
    "Click below to join the session:",
    joinUrl,
    "",
    "If the link does not work, sign in to your Huckleberry Mentorships account and open the workspace from your dashboard.",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Mentorship call started</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          <strong>${escapeHtml(args.instructorName)}</strong> has started a mentorship call in
          <strong>${escapeHtml(args.workspaceName)}</strong>.
        </div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Click the button below to join the session.
        </div>
        <a href="${joinUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Join the call</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button does not work, copy/paste this link:<br/>
          <div>${joinUrl}</div>
        </p>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "ad_hoc_call_invite" } };
}
