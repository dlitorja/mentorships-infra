import { getBaseUrl } from "./send";
import { buildAuthRedirectUrl } from "./auth-redirect-link";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Builds an ad-hoc call invitation email for the OTHER workspace
 * participant (whichever party did NOT start the call).
 *
 * Sent when EITHER party on a workspace starts an ad-hoc
 * mentorship call (PR #797 extended this beyond instructor-only),
 * and the recipient is offline / away from the workspace UI.
 *
 * PR-E (Issue 5): the deep-link target is now wrapped with
 * `buildAuthRedirectUrl(baseUrl, '/workspace/{workspaceId}?join={sessionId}')`,
 * i.e. rendered as `${baseUrl}/auth-redirect?redirect_url=…`. The
 * wrapping preserves the destination across the signed-out →
 * signed-in bounce — previously bare `${baseUrl}/workspace/<id>…`
 * links dropped into the role-driven default because Clerk's
 * sign-in page sits between the link click and the workspace
 * page. The auth-redirect route's whitelist already accepts
 * `/workspace/` (extended in this same PR).
 *
 * The caller's display name and workspace name are interpolated
 * so the email reads as a personal invite rather than a generic
 * notification. Names are escaped defensively even though the
 * inputs come from auth-gated server code paths — defense in
 * depth for the case where a future code path accepts
 * user-supplied names.
 *
 * PR #incoming-call-caller-role: renamed `instructorName` →
 * `callerName` and added `callerRole` so the subject/body match
 * who actually started the call. The previous wording always
 * framed it as the instructor, which was misleading when the
 * student was the caller and the instructor was the recipient.
 *
 * @param args.callerName - Display name of the person who started the call
 * @param args.callerRole - "instructor" or "student"; selects the
 *   sentence framing ("Your instructor…" vs "Your student…")
 * @param args.workspaceName - Display name of the mentorship workspace
 * @param args.workspaceId - Convex workspace id, used to build the deep link
 * @param args.sessionId - Convex session id, used to build the deep link
 * @returns Email payload with subject, text, HTML, and X-Email-Type header
 */
export function buildAdHocCallInviteEmail(args: {
  callerName: string;
  callerRole: "instructor" | "student";
  workspaceName: string;
  workspaceId: string;
  sessionId: string;
}) {
  const joinUrl = buildAuthRedirectUrl(
    getBaseUrl(),
    `/workspace/${args.workspaceId}?join=${args.sessionId}`,
  );
  const callerPronoun =
    args.callerRole === "instructor" ? "Your instructor" : "Your student";
  const trimmedName = args.callerName.trim();
  // When the caller-name lookup failed, fall back to the role-only
  // framing rather than emitting duplicated role wording like
  // "Your instructor Your instructor has started…" (Greptile P2).
  const subject = trimmedName.length > 0
    ? `${trimmedName} started a mentorship call`
    : `${callerPronoun} started a mentorship call`;

  const bodyOpening = trimmedName.length > 0
    ? `${callerPronoun} ${trimmedName} has started a mentorship call in ${args.workspaceName}.`
    : `${callerPronoun} has started a mentorship call in ${args.workspaceName}.`;

  const text = [
    bodyOpening,
    "",
    "Click below to join the session:",
    joinUrl,
    "",
    "If the link does not work, sign in to your Huckleberry Mentorships account and open the workspace from your dashboard.",
  ].join("\n");

  const nameHtmlBlock = trimmedName.length > 0
    ? `${escapeHtml(callerPronoun)} <strong>${escapeHtml(trimmedName)}</strong> has started a mentorship call in
       <strong>${escapeHtml(args.workspaceName)}</strong>.`
    : `${escapeHtml(callerPronoun)} has started a mentorship call in
       <strong>${escapeHtml(args.workspaceName)}</strong>.`;

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Mentorship call started</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          ${nameHtmlBlock}
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
