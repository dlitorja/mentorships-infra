import { getBaseUrl } from "./send";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export type RecordingReadyEmailPayload = {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

/**
 * Builds the "your session recording is ready" email for the
 * workspace owner (student).
 *
 * Sent by the `notify-recording-ready` Trigger task (PR #2) once
 * the visibility gate has passed and the row has been flipped to
 * `ready_to_send`. Subject + body mirror the convention used by
 * `session-changes.ts` (HTML inline-styled, plain-text fallback,
 * workspace-scoped deep link).
 *
 * The deep-link target is `${baseUrl}/workspace/{workspaceId}?videos={sessionId}`.
 * The `?videos={sessionId}` query param will be honoured by PR #3
 * (the Videos tab scroll-into-view wiring). For PR #2 the link
 * simply lands on the Videos tab — opening it from email is fine.
 *
 * @param args.studentEmail - Recipient email address (unused — kept for parity with `SessionEmailPayload`)
 * @param args.studentName - Greetee first name; falls back to "there" when missing
 * @param args.instructorName - The instructor who led the session, surfaced in the body
 * @param args.workspaceId - Used to build the deep link
 * @param args.sessionId - Used to build the deep link and as the X-Email-Session header
 * @returns Email payload with subject, text, HTML, and headers
 */
export function buildRecordingReadyEmail(args: {
  studentEmail: string;
  studentName: string | null;
  instructorName: string;
  workspaceId: string;
  sessionId: string;
}): RecordingReadyEmailPayload {
  const greetingName = args.studentName?.trim() || "there";
  const recordingsUrl = `${getBaseUrl()}/workspace/${args.workspaceId}?videos=${args.sessionId}`;

  const subject = "Your session recording is ready to view";

  const text = [
    `Hi ${greetingName},`,
    "",
    "Your recent mentorship session recording is now available in your workspace.",
    "",
    `Instructor: ${args.instructorName}`,
    "",
    `Watch the recording: ${recordingsUrl}`,
    "",
    "Recordings stay available until your workspace retention period expires. " +
      "You can re-watch or download them any time from the Videos tab.",
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px;color:#059669">🎬 Recording Ready</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(greetingName)}, your recent mentorship session recording is now available.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Session</div>
          <div style="font-size:14px;color:#374151">👤 Instructor: ${escapeHtml(args.instructorName)}</div>
        </div>
        <a href="${recordingsUrl}" style="display:inline-block;padding:12px 16px;background:#059669;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">
          Watch Recording
        </a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          Recordings stay available until your workspace retention period expires.
          You can re-watch or download them any time from the Videos tab.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    text,
    html,
    headers: {
      "X-Email-Type": "recording_ready_student",
      "X-Email-Session": args.sessionId,
    },
  };
}
