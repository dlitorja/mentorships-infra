import { createHash } from "node:crypto";
import { inngest } from "../client";
import { sendEmail } from "@/lib/email";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportError } from "@/lib/observability";
import { buildInviteReminderEmail } from "@/lib/emails/invite-reminder";
import { buildInstructorReviewReminderEmail } from "@/lib/emails/instructor-review-reminder";
import { buildAdminStale7dDigestEmail } from "@/lib/emails/admin-stale-7d-digest";

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

function inviteStaged(item: InviteItem, baseUrl: string): StagedItem {
  const content = buildInviteReminderEmail({
    studentName: item.studentName,
    instructorName: item.instructorName,
    signUpUrl: `${baseUrl}/sign-up`,
    appUrl: baseUrl,
    final: item.kind === "student_invite_5d",
  });
  return {
    dedupeKey: item.dedupeKey,
    onboardingId: item.onboardingId,
    kind: item.kind,
    recipient: item.studentEmail,
    recipientName: item.studentName,
    recipientKind: "student",
    subject: content.subject,
    previewText: content.text,
    context: JSON.stringify({
      studentName: item.studentName,
      instructorName: item.instructorName,
      final: item.kind === "student_invite_5d",
    }),
    reason: item.studentEmail
      ? `Student has no account after ${item.daysPending} day(s).`
      : "Student has no account.",
  };
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

    const stageResult = await step.run("stage-candidates", async () => {
      const scanned = await convexServerCall<ScanResult>(
        "/onboarding-follow-ups/scan",
        {}
      );

      const items: StagedItem[] = [
        ...scanned.studentInvites48h.map((item) => inviteStaged(item, baseUrl)),
        ...scanned.studentInvites5d.map((item) => inviteStaged(item, baseUrl)),
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

    let sent = 0;

    // The admin digest is one email per batch: collapse all approved
    // `admin_stale_7d` rows into a single message.
    const adminRows = approved.filter((item) => item.kind === "admin_stale_7d");
    const direct = approved.filter((item) => item.kind !== "admin_stale_7d");

    for (const item of direct) {
      await step.run(`send:${item.dedupeKey}`, async () => {
        const context = JSON.parse(item.context) as Record<string, unknown>;

        const content =
          item.kind === "instructor_review_3d"
            ? buildInstructorReviewReminderEmail({
                instructorName: String(context.instructorName ?? ""),
                studentName: String(context.studentName ?? ""),
                reviewUrl: `${baseUrl}/onboarding/${item.onboardingId}`,
              })
            : buildInviteReminderEmail({
                studentName: String(context.studentName ?? ""),
                instructorName: String(context.instructorName ?? ""),
                signUpUrl: `${baseUrl}/sign-up`,
                appUrl: baseUrl,
                final: Boolean(context.final),
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

    const summary = {
      staged: stageResult.staged,
      approved: approved.length,
      sent,
    };

    if (stageResult.staged > 0 || sent > 0) {
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
