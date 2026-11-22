import { createHash } from "node:crypto";
import { inngest } from "../client";
import { sendEmail } from "@/lib/email";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportError } from "@/lib/observability";
import { buildInviteReminderEmail } from "@/lib/emails/invite-reminder";
import { buildInstructorReviewReminderEmail } from "@/lib/emails/instructor-review-reminder";
import { buildAdminStale7dDigestEmail } from "@/lib/emails/admin-stale-7d-digest";
import { buildReminderSendSummaryEmail } from "@/lib/emails/reminder-send-summary";

/**
 * Hourly follow-up nudges:
 *   - 48h after onboarding, student has no account → student reminder
 *   - 5d after onboarding, still no account → final student reminder
 *   - 7d after onboarding, still no account → admin check-in digest
 *   - 3d after questionnaire submission, instructor has not reviewed → nudge
 *
 * Two phases, and the first one never sends:
 *
 *   1. Stage. Everything the scan selects is built and written to the reminder
 *      outbox as `pending_review`. An admin approves or suppresses each item in
 *      /admin/onboarding-reminders.
 *   2. Send. Approved rows are claimed and sent, then marked `sent`.
 *
 * The Convex scan excludes anything already recorded in `onboardingReminders`
 * (pending, approved, sent, or suppressed), so a cron replay cannot re-queue an
 * item an admin already refused. Resend idempotency keys cover the gap between
 * a successful send and the mark call.
 */

type InviteItem = {
  onboardingId: string;
  dedupeKey: string;
  kind: "student_invite_48h" | "student_invite_5d" | "admin_stale_7d";
  studentEmail: string;
  studentName: string;
  instructorName: string;
  daysPending: number;
};

type ReviewItem = {
  onboardingId: string;
  submissionId: string;
  dedupeKey: string;
  kind: "instructor_review_3d";
  instructorId: string;
  instructorName: string;
  instructorEmail: string;
  studentName: string;
  studentEmail: string;
  submittedAt: number;
};

type ScanResult = {
  studentInvites48h: InviteItem[];
  studentInvites5d: InviteItem[];
  adminStale7d: InviteItem[];
  instructorReviews: ReviewItem[];
};

type StagedKind = InviteItem["kind"] | ReviewItem["kind"];

type StagedItem = {
  dedupeKey: string;
  onboardingId: string;
  kind: StagedKind;
  recipient: string;
  recipientName?: string;
  recipientKind: "student" | "instructor" | "admin";
  subject: string;
  previewText: string;
  context: string;
  reason: string;
};

type ApprovedItem = {
  dedupeKey: string;
  onboardingId: string;
  kind: StagedKind;
  recipient: string;
  recipientName: string | null;
  subject: string;
  context: string;
};

function appBaseUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!candidate) {
    throw new Error(
      "onboarding-follow-ups: NEXT_PUBLIC_URL / NEXT_PUBLIC_APP_URL / VERCEL_URL must be set"
    );
  }
  return candidate.replace(/\/+$/, "");
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "admin@huckleberry.art")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

async function markSent(args: {
  dedupeKey: string;
  onboardingId: string;
  kind: StagedKind;
  recipient: string;
  resendId?: string;
}): Promise<void> {
  await convexServerCall("/onboarding-follow-ups/mark-sent", args);
}

function adminDigestStaged(item: InviteItem): StagedItem {
  const content = buildAdminStale7dDigestEmail({
    rows: [
      {
        studentName: item.studentName,
        studentEmail: item.studentEmail,
        instructorName: item.instructorName,
        daysPending: item.daysPending,
        onboardingUrl: `${appBaseUrl()}/admin/onboardings/${item.onboardingId}`,
      },
    ],
  });
  return {
    dedupeKey: item.dedupeKey,
    onboardingId: item.onboardingId,
    kind: "admin_stale_7d",
    recipient: adminEmails().join(","),
    recipientName: "Admins",
    recipientKind: "admin",
    subject: content.subject,
    previewText: content.text,
    context: JSON.stringify({
      studentName: item.studentName,
      studentEmail: item.studentEmail,
      instructorName: item.instructorName,
      daysPending: item.daysPending,
    }),
    reason: `No student account after ${item.daysPending} day(s).`,
  };
}

export const onboardingFollowUps = inngest.createFunction(
  {
    id: "onboarding-follow-ups",
    name: "Onboarding follow-up reminders",
    retries: 2,
    triggers: [
      { cron: "15 * * * *" },
      { event: "onboarding/followups.run" },
      // Fired when an admin approves a batch, so a fresh decision does not wait
      // for the next hourly tick.
      { event: "onboarding/followups.send" },
    ],
  },
  async ({ step }) => {
    const baseUrl = appBaseUrl();

    const scanned = await step.run("scan", async () => {
      return await convexServerCall<ScanResult>(
        "/onboarding-follow-ups/scan",
        {}
      );
    });

    let sent = 0;

    // Student invites are automatic: the student has no account yet, the
    // reminder is time-sensitive, and holding it for review would cost days.
    // Each send is reported in the summary digest below.
    const autoSent: Array<{
      kind: "student_invite_48h" | "student_invite_5d";
      studentName: string;
      studentEmail: string;
      onboardingId: string;
      sentAt: number;
    }> = [];

    for (const item of [
      ...scanned.studentInvites48h.map((item) => ({
        ...item,
        kind: "student_invite_48h" as const,
      })),
      ...scanned.studentInvites5d.map((item) => ({
        ...item,
        kind: "student_invite_5d" as const,
      })),
    ]) {
      // The step returns the summary row so an Inngest replay keeps the data
      // instead of re-running the send.
      const summaryRow = await step.run(
        `send-invite:${item.dedupeKey}`,
        async () => {
          const content = buildInviteReminderEmail({
            studentName: item.studentName,
            instructorName: item.instructorName,
            signUpUrl: `${baseUrl}/sign-up`,
            appUrl: baseUrl,
            final: item.kind === "student_invite_5d",
          });
          const result = await sendEmail({
            to: item.studentEmail,
            subject: content.subject,
            html: content.html,
            text: content.text,
            headers: content.headers,
            kind: "transactional",
            idempotencyKey: item.dedupeKey,
          });
          if (!result.ok) {
            throw new Error(
              `invite reminder failed for ${item.dedupeKey}: ${
                "error" in result ? result.error : "unknown"
              }`
            );
          }
          await markSent({
            dedupeKey: item.dedupeKey,
            onboardingId: item.onboardingId,
            kind: item.kind,
            recipient: item.studentEmail,
            resendId: result.id ?? undefined,
          });
          return {
            kind: item.kind,
            studentName: item.studentName,
            studentEmail: item.studentEmail,
            onboardingId: item.onboardingId,
            sentAt: Date.now(),
          };
        }
      );
      autoSent.push(summaryRow);
      sent += 1;
    }

    // Everything else waits for an admin: the instructor nudge is the one that
    // reached someone who had already met the student, and the 7-day digest is
    // an admin-facing nudge that benefits from a human check.
    const stageResult = await step.run("stage-gated-candidates", async () => {
      const items: StagedItem[] = [
        ...scanned.adminStale7d.map((item) => adminDigestStaged(item)),
        ...scanned.instructorReviews.map((item) => {
          const content = buildInstructorReviewReminderEmail({
            instructorName: item.instructorName,
            studentName: item.studentName,
            reviewUrl: `${baseUrl}/onboarding/${item.onboardingId}`,
          });
          return {
            dedupeKey: item.dedupeKey,
            onboardingId: item.onboardingId,
            kind: item.kind,
            recipient: item.instructorEmail,
            recipientName: item.instructorName,
            recipientKind: "instructor" as const,
            subject: content.subject,
            previewText: content.text,
            context: JSON.stringify({
              instructorName: item.instructorName,
              studentName: item.studentName,
            }),
            reason: `${item.studentName}'s questionnaire has been waiting 3+ days.`,
          };
        }),
      ];

      if (items.length > 0) {
        await convexServerCall("/onboarding-follow-ups/enqueue", { items });
      }
      return { staged: items.length };
    });

    // Claiming marks the rows `sending` in the same transaction that returns
    // them, so two overlapping runs cannot both send the same row. Claim in
    // batches until the queue is drained — one approval request can carry up to
    // 100 rows and fires a single event, so a single 50-row claim would leave
    // the rest waiting for the next hourly tick.
    const CLAIM_BATCH = 50;
    const MAX_CLAIM_BATCHES = 4;
    const approved: ApprovedItem[] = [];
    for (let batch = 0; batch < MAX_CLAIM_BATCHES; batch++) {
      const items = await step.run(`claim-approved-${batch}`, async () => {
        const result = await convexServerCall<{ items: ApprovedItem[] }>(
          "/onboarding-follow-ups/claim",
          { limit: CLAIM_BATCH }
        );
        return result.items;
      });
      approved.push(...items);
      if (items.length < CLAIM_BATCH) break;
    }

    // The admin digest is one email per batch: collapse all approved
    // `admin_stale_7d` rows into a single message.
    const adminRows = approved.filter((item) => item.kind === "admin_stale_7d");
    const direct = approved.filter((item) => item.kind !== "admin_stale_7d");

    for (const item of direct) {
      await step.run(`send:${item.dedupeKey}`, async () => {
        const context = JSON.parse(item.context) as Record<string, unknown>;
        const content = buildInstructorReviewReminderEmail({
          instructorName: String(context.instructorName ?? ""),
          studentName: String(context.studentName ?? ""),
          reviewUrl: `${baseUrl}/onboarding/${item.onboardingId}`,
        });

        const result = await sendEmail({
          to: item.recipient,
          subject: content.subject,
          html: content.html,
          text: content.text,
          headers: content.headers,
          kind: "transactional",
          idempotencyKey: item.dedupeKey,
        });
        if (!result.ok) {
          throw new Error(
            `reminder send failed for ${item.dedupeKey}: ${
              "error" in result ? result.error : "unknown"
            }`
          );
        }
        await markSent({
          dedupeKey: item.dedupeKey,
          onboardingId: item.onboardingId,
          kind: item.kind,
          recipient: item.recipient,
          resendId: result.id ?? undefined,
        });
        sent += 1;
      });
    }

    if (adminRows.length > 0) {
      await step.run("send:admin-stale-7d-digest", async () => {
        const recipients = adminEmails();
        const rows = adminRows.map((item) => {
          const context = JSON.parse(item.context) as Record<string, unknown>;
          return {
            studentName: String(context.studentName ?? ""),
            studentEmail: String(context.studentEmail ?? ""),
            instructorName: String(context.instructorName ?? ""),
            daysPending: Number(context.daysPending ?? 0),
            onboardingUrl: `${baseUrl}/admin/onboardings/${item.onboardingId}`,
          };
        });
        const content = buildAdminStale7dDigestEmail({ rows });
        const digestKey = createHash("sha256")
          .update(adminRows.map((item) => item.dedupeKey).join("|"))
          .digest("hex")
          .slice(0, 24);

        let firstId: string | undefined;
        let delivered = 0;
        for (const adminEmail of recipients) {
          const result = await sendEmail({
            to: adminEmail,
            subject: content.subject,
            html: content.html,
            text: content.text,
            headers: content.headers,
            kind: "transactional",
            idempotencyKey: `admin_stale_7d:${digestKey}:${adminEmail}`,
          });
          if (result.ok) {
            delivered += 1;
            firstId = firstId ?? result.id ?? undefined;
          }
        }
        if (delivered === 0) {
          throw new Error("admin stale 7d digest failed for every recipient");
        }

        for (const item of adminRows) {
          await markSent({
            dedupeKey: item.dedupeKey,
            onboardingId: item.onboardingId,
            kind: item.kind,
            recipient: recipients.join(","),
            resendId: firstId,
          });
        }
        sent += delivered;
      });
    }

    // Report the automatic sends. This is the only notification for email that
    // leaves without an approval, so it is best-effort-but-loud: a total failure
    // throws (and Inngest retries the step with the same idempotency key).
    if (autoSent.length > 0) {
      const summaryKey = createHash("sha256")
        .update(autoSent.map((row) => `${row.onboardingId}:${row.kind}`).join("|"))
        .digest("hex")
        .slice(0, 24);

      await step.run("send-auto-summary", async () => {
        const content = buildReminderSendSummaryEmail({
          rows: autoSent.map((row) => ({
            kind: row.kind,
            studentName: row.studentName,
            studentEmail: row.studentEmail,
            onboardingUrl: `${baseUrl}/admin/onboardings/${row.onboardingId}`,
            sentAt: row.sentAt,
          })),
        });

        let delivered = 0;
        for (const adminEmail of adminEmails()) {
          const result = await sendEmail({
            to: adminEmail,
            subject: content.subject,
            html: content.html,
            text: content.text,
            headers: content.headers,
            kind: "transactional",
            idempotencyKey: `onboarding_auto_summary:${summaryKey}:${adminEmail}`,
          });
          if (result.ok) delivered += 1;
        }
        if (delivered === 0) {
          throw new Error("automatic reminder summary failed for every recipient");
        }
      });
    }

    const summary = {
      autoSent: autoSent.length,
      staged: stageResult.staged,
      approved: approved.length,
      sent,
    };

    if (summary.autoSent > 0 || summary.staged > 0 || sent > 0) {
      await reportError({
        source: "inngest:onboarding-follow-ups",
        error: null,
        level: "info",
        message: "Onboarding follow-ups staged/sent",
        context: summary,
      });
    }

    return summary;
  }
);
