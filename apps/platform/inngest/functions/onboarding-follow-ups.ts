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
 * The Convex scan excludes anything already marked in `onboardingReminders`,
 * and every send is marked after the provider accepts it. A cron replay is
 * therefore safe; Resend idempotency keys cover the gap between a successful
 * send and the mark call.
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

async function markSent(args: {
  dedupeKey: string;
  onboardingId: string;
  kind: InviteItem["kind"] | ReviewItem["kind"];
  recipient: string;
  resendId?: string;
}): Promise<void> {
  await convexServerCall("/onboarding-follow-ups/mark-sent", args);
}

export const onboardingFollowUps = inngest.createFunction(
  {
    id: "onboarding-follow-ups",
    name: "Onboarding follow-up reminders",
    retries: 2,
    triggers: [
      { cron: "15 * * * *" },
      { event: "onboarding/followups.run" },
    ],
  },
  async ({ step }) => {
    const scanned = await step.run("scan", async (): Promise<ScanResult> => {
      return await convexServerCall<ScanResult>("/onboarding-follow-ups/scan", {});
    });

    const baseUrl = appBaseUrl();
    let sent = 0;

    async function sendInvite(item: InviteItem): Promise<void> {
      await step.run(`invite:${item.dedupeKey}`, async () => {
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
        sent += 1;
      });
    }

    for (const item of scanned.studentInvites48h) {
      await sendInvite(item);
    }
    for (const item of scanned.studentInvites5d) {
      await sendInvite(item);
    }

    if (scanned.adminStale7d.length > 0) {
      await step.run("admin-stale-7d-digest", async () => {
        const adminEmails = (process.env.ADMIN_EMAILS || "admin@huckleberry.art")
          .split(",")
          .map((email) => email.trim())
          .filter(Boolean);
        const content = buildAdminStale7dDigestEmail({
          rows: scanned.adminStale7d.map((item) => ({
            studentName: item.studentName,
            studentEmail: item.studentEmail,
            instructorName: item.instructorName,
            daysPending: item.daysPending,
            onboardingUrl: `${baseUrl}/admin/onboardings/${item.onboardingId}`,
          })),
        });
        const digestKey = createHash("sha256")
          .update(scanned.adminStale7d.map((item) => item.dedupeKey).join("|"))
          .digest("hex")
          .slice(0, 24);

        let firstId: string | undefined;
        let delivered = 0;
        for (const adminEmail of adminEmails) {
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

        for (const item of scanned.adminStale7d) {
          await markSent({
            dedupeKey: item.dedupeKey,
            onboardingId: item.onboardingId,
            kind: "admin_stale_7d",
            recipient: adminEmails.join(","),
            resendId: firstId,
          });
        }
        sent += delivered;
      });
    }

    for (const item of scanned.instructorReviews) {
      await step.run(`review:${item.dedupeKey}`, async () => {
        const content = buildInstructorReviewReminderEmail({
          instructorName: item.instructorName,
          studentName: item.studentName,
          reviewUrl: `${baseUrl}/onboarding/${item.onboardingId}`,
        });
        const result = await sendEmail({
          to: item.instructorEmail,
          subject: content.subject,
          html: content.html,
          text: content.text,
          headers: content.headers,
          kind: "transactional",
          idempotencyKey: item.dedupeKey,
        });
        if (!result.ok) {
          throw new Error(
            `instructor review reminder failed for ${item.dedupeKey}: ${
              "error" in result ? result.error : "unknown"
            }`
          );
        }
        await markSent({
          dedupeKey: item.dedupeKey,
          onboardingId: item.onboardingId,
          kind: "instructor_review_3d",
          recipient: item.instructorEmail,
          resendId: result.id ?? undefined,
        });
        sent += 1;
      });
    }

    const summary = {
      student48h: scanned.studentInvites48h.length,
      student5d: scanned.studentInvites5d.length,
      admin7d: scanned.adminStale7d.length,
      instructorReview3d: scanned.instructorReviews.length,
      sent,
    };

    if (sent > 0) {
      await reportError({
        source: "inngest:onboarding-follow-ups",
        error: null,
        level: "info",
        message: "Onboarding follow-up reminders sent",
        context: summary,
      });
    }

    return summary;
  }
);
