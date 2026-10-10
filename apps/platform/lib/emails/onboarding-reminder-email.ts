/**
 * PR 12 PR 4b — onboarding questionnaire abandonment reminder email.
 *
 * Sent by the Inngest cron `onboarding-questionnaire-reminders` when
 * a student's draft is stale (no `lastSeenAt` for
 * `ONBOARDING_REMINDER_STALE_MS`) and the row has not yet hit the
 * `ONBOARDING_REMINDER_MAX_COUNT` cap. The cron re-checks
 * `submission.status === "draft"` at send time to avoid racing a
 * beacon-then-submit.
 *
 * HTML-escapes every user-supplied value (student name, email,
 * onboarding id never user-controlled). Single CTA links to
 * `/sign-in?redirect_url=/onboarding/[id]/questionnaire` so a
 * logged-out tab lands back on the right page after auth.
 */

export type OnboardingReminderEmailArgs = {
  studentName: string | null;
  studentEmail: string;
  onboardingId: string;
  questionnaireUrl: string;
  /** 1-indexed for human copy ("reminder 2 of 3") */
  reminderNumber: number;
  maxReminders: number;
};

export type OnboardingReminderEmail = {
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

export function buildOnboardingReminderEmail(
  args: OnboardingReminderEmailArgs
): OnboardingReminderEmail {
  const greetingName = args.studentName?.trim() ? args.studentName.trim() : "there";
  const safeName = escapeHtml(greetingName);
  const safeUrl = escapeAttr(args.questionnaireUrl);

  const subject =
    args.reminderNumber === 1
      ? "Finish your mentorship onboarding"
      : `Reminder ${args.reminderNumber} of ${args.maxReminders}: finish your mentorship onboarding`;

  const text = [
    `Hi ${greetingName},`,
    "",
    args.reminderNumber === 1
      ? "Your instructor is waiting for your answers before your first call."
      : `This is reminder ${args.reminderNumber} of ${args.maxReminders} — your draft is still saved, just one click away from being submitted.`,
    "",
    "Tell them about your goals and inspirations, and share a few examples of your recent work. It takes about 5 minutes.",
    "",
    `Continue here: ${args.questionnaireUrl}`,
    "",
    "If you have any trouble, just reply to this email and we'll help.",
    "",
    "— The mentorships team",
  ].join("\n");

  const html = `
    <p>Hi ${safeName},</p>
    ${
      args.reminderNumber === 1
        ? `<p>Your instructor is waiting for your answers before your first call.</p>`
        : `<p>This is reminder ${args.reminderNumber} of ${args.maxReminders} &mdash; your draft is still saved, just one click away from being submitted.</p>`
    }
    <p>Tell them about your goals and inspirations, and share a few examples of your recent work. It takes about 5 minutes.</p>
    <p><a href="${safeUrl}">Continue your questionnaire</a></p>
    <p>If you have any trouble, just reply to this email and we'll help.</p>
    <p>&mdash; The mentorships team</p>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {},
  };
}
