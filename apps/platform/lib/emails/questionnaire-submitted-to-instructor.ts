/**
 * HUC-95 — Instructor notification email for a submitted
 * onboarding questionnaire.
 *
 * Sent by the Inngest consumer
 * `apps/platform/inngest/functions/onboarding-questionnaire-submitted-notification.ts`
 * to each assigned instructor when a student submits their
 * questionnaire. The consumer renders this template once per
 * recipient, hands the result to `sendEmail` with a stable
 * `idempotencyKey` (`questionnaire-submitted-notification:{submissionId}:{instructorId}`),
 * and Resend dedupes any re-deliveries.
 *
 * Per AGENTS.md content guard rails:
 *
 *   * We HTML-escape every user-controlled value (student
 *     name, deep-link URL).
 *   * We do NOT use the words `mentor`/`mentee` anywhere in
 *     the rendered copy — the existing onboarding copy already
 *     uses `instructor`/`student`.
 *   * The single CTA is a deep link to `/onboarding/[id]` —
 *     the shared student-facing status page that also
 *     serves instructors via the role-gated read path
 *     (`getSubmittedQuestionnaireForViewer` in
 *     `convex/onboardingQuestionnaire.ts`). We don't link to
 *     a separate `/instructor/onboarding/[id]` route because
 *     none exists; the shared page already renders the
 *     instructor-context view for that role.
 */

export type QuestionnaireSubmittedToInstructorEmailArgs = {
  /** Clerk display name from the `users` table (resolved by the
   *  consumer via the Convex HTTP endpoint). May be null/undefined
   *  for imported-but-unlinked students — we fall back to the
   *  email's local-part or a generic greeting. */
  studentName: string | null;
  /** Student email used for the "Sent by" footnote and to
   *  construct the fallback greeting. */
  studentEmail: string;
  /** Convex adminOnboarding id — used to build the deep link. */
  onboardingId: string;
  /** Submission timestamp (epoch ms) for the human copy. */
  submittedAt: number;
  /** Fully-qualified deep link to `/onboarding/[id]`. The
   *  consumer builds the URL using the shared `getBaseUrl()`
   *  helper and embeds the onboarding id as the path segment. */
  submissionUrl: string;
};

export type QuestionnaireSubmittedToInstructorEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/**
 * Format an epoch ms timestamp in the user's local timezone is
 * NOT what we want here (the email server doesn't know the
 * recipient's tz). We render as a UTC ISO string with a
 * parenthetical `UTC` so the recipient reads an unambiguous
 * value and can re-derive their local time at a glance.
 */
function formatUtc(ms: number): string {
  try {
    const d = new Date(ms);
    // Trim milliseconds + Z so the string is short and
    // human-recognisable. ISO 8601 is well-known enough that
    // every email client can render it.
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return new Date(ms).toString();
  }
}

export function buildQuestionnaireSubmittedToInstructorEmail(
  args: QuestionnaireSubmittedToInstructorEmailArgs
): QuestionnaireSubmittedToInstructorEmail {
  const trimmedName = args.studentName?.trim();
  let greetingName: string;
  if (trimmedName && trimmedName.length > 0) {
    greetingName = trimmedName;
  } else {
    // Fall back to the email's local-part (everything
    // before the `@`). We deliberately use a non-null
    // check (not just `??`) because an empty local-part —
    // e.g. an address like `@example.com` — is user data
    // that should NOT render as a literal empty string in
    // an email subject line. The empty local-part
    // exercises the second fallback.
    const localPart = args.studentEmail.split("@")[0]?.trim();
    greetingName = localPart && localPart.length > 0 ? localPart : "a new student";
  }
  const safeName = escapeHtml(greetingName);
  const safeStudentEmail = escapeHtml(args.studentEmail);
  const safeUrl = escapeAttr(args.submissionUrl);
  const submittedAtStr = formatUtc(args.submittedAt);

  const subject = `[Huckleberry] New student intro from ${greetingName}`;

  const text = [
    `Hi,`,
    "",
    `${greetingName} just submitted their onboarding questionnaire. They've shared a few answers, inspirations, and work examples so you can get a sense of who they are before your first call.`,
    "",
    `Submitted at: ${submittedAtStr} UTC`,
    `Student email: ${args.studentEmail}`,
    "",
    `Review it here: ${args.submissionUrl}`,
    "",
    "If anything looks off, just reply to this email and we'll help.",
    "",
    "— The mentorships team",
  ].join("\n");

  const html = `
    <p>Hi,</p>
    <p>
      <strong>${safeName}</strong> just submitted their onboarding questionnaire. They've shared a few
      answers, inspirations, and work examples so you can get a sense of who they are before your first
      call.
    </p>
    <p>
      Submitted at: <strong>${escapeHtml(submittedAtStr)} UTC</strong><br />
      Student email: <a href="mailto:${safeStudentEmail}">${safeStudentEmail}</a>
    </p>
    <p><a href="${safeUrl}">Review the intro</a></p>
    <p>If anything looks off, just reply to this email and we'll help.</p>
    <p>&mdash; The mentorships team</p>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {},
  };
}
