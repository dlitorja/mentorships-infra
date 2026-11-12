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
 * PR-E (Issue 5): the deep-link target is wrapped with
 * `buildAuthRedirectUrl(baseUrl, '/workspace/{workspaceId}?join={sessionId}')`,
 * i.e. rendered as `${baseUrl}/auth-redirect?redirect_url=…`. The
 * wrapping preserves the destination across the signed-out →
 * signed-in bounce — a bare `${baseUrl}/workspace/<id>…` link drops
 * into the role-driven default because Clerk's sign-in page sits
 * between the link click and the workspace page. The auth-redirect
 * route's whitelist accepts `/workspace/`.
 *
 * Clickability is part of the contract, not cosmetics: the href and
 * the "use this link" fallback are both absolute URLs, both
 * HTML-escaped, and the fallback is a real `<a>` rather than plain
 * text inside a `<div>`. When `getBaseUrl()` returned a placeholder
 * the fallback was text a recipient could not click, and the button
 * carried a relative href their client refused to activate.
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
 * Subject personalization lives here rather than in the Trigger task
 * so the greeting logic is unit-testable. It deliberately renders as
 * "Sarah Lee started a mentorship call" — the task previously
 * prefixed the recipient's name in brackets (`[Jane] Sarah Lee…`,
 * and `[there] …` when the name lookup came back empty), which read
 * like a broken template.
 *
 * @param args.callerName - Display name of the person who started the call
 * @param args.callerRole - "instructor" or "student"; selects the
 *   sentence framing ("Your instructor…" vs "Your student…")
 * @param args.workspaceName - Display name of the mentorship workspace
 * @param args.workspaceId - Convex workspace id, used to build the deep link
 * @param args.sessionId - Convex session id, used to build the deep link
 * @param args.recipientFirstName - Optional first name of the recipient,
 *   used for the greeting only ("Hi Jane,"). Omitted when unknown so the
 *   email never opens with "Hi there,".
 * @returns Email payload with subject, text, HTML, and X-Email-Type header
 */
export function buildAdHocCallInviteEmail(args: {
  callerName: string;
  callerRole: "instructor" | "student";
  workspaceName: string;
  workspaceId: string;
  sessionId: string;
  recipientFirstName?: string | null;
}) {
  const joinUrl = buildAuthRedirectUrl(
    getBaseUrl(),
    `/workspace/${args.workspaceId}?join=${args.sessionId}`,
  );
  const callerPronoun =
    args.callerRole === "instructor" ? "Your instructor" : "Your student";
  const trimmedName = args.callerName.trim();
  // Greeting only when the recipient's first name is known — "Hi there,"
  // reads worse than no greeting at all.
  const recipientName = args.recipientFirstName?.trim() || null;
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
    ...(recipientName ? [`Hi ${recipientName},`, ""] : []),
    bodyOpening,
    "",
    "Open this link to go to the workspace and join the call:",
    joinUrl,
    "",
    "You will be asked to sign in if you are not already signed in. " +
      "If the call has already ended, the link opens the workspace instead.",
    "",
    "Huckleberry Mentorships",
  ].join("\n");

  const nameHtmlBlock = trimmedName.length > 0
    ? `${escapeHtml(callerPronoun)} <strong>${escapeHtml(trimmedName)}</strong> has started a mentorship call in
       <strong>${escapeHtml(args.workspaceName)}</strong>.`
    : `${escapeHtml(callerPronoun)} has started a mentorship call in
       <strong>${escapeHtml(args.workspaceName)}</strong>.`;

  // Escaped for use in an attribute (`&` → `&amp;`). The value is a
  // URL, so escaping is invisible to the client but keeps the markup
  // valid if the base URL ever gains a query string.
  const escapedJoinUrl = escapeHtml(joinUrl);

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Mentorship call started</div>
        ${recipientName ? `<div style="color:#374151;line-height:1.6;margin-bottom:12px">Hi ${escapeHtml(recipientName)},</div>` : ""}
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          ${nameHtmlBlock}
        </div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Tap the button to open the workspace and join the call.
        </div>
        <a href="${escapedJoinUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Join the call</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px;line-height:1.6">
          If the button does not work, use this link:<br/>
          <a href="${escapedJoinUrl}" style="color:#2563EB;word-break:break-all;overflow-wrap:anywhere">${escapedJoinUrl}</a>
        </p>
        <p style="margin:12px 0 0 0;color:#6B7280;font-size:12px;line-height:1.6">
          You will be asked to sign in if you are not already signed in.
          If the call has already ended, the link opens the workspace instead.
        </p>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "ad_hoc_call_invite" } };
}
