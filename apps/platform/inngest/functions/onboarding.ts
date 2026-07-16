import { clerkClient } from "@clerk/nextjs/server";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { sendEmail, sendTemplateEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";
import { buildPurchaseOnboardingEmail } from "@/lib/emails/purchase-onboarding-email";
import { buildInstructorOnboardingEmail } from "@/lib/emails/instructor-onboarding-email";
import { buildAdminPurchaseEmail } from "@/lib/emails/admin-purchase-notification-email";
import {
  purchaseInstructorEventSchema,
  adminOnboardingCompletedEventSchema,
} from "../types";
import { inngest } from "../client";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

type ClerkExternalAccountLike = {
  provider?: unknown;
  providerUserId?: unknown;
};

function getDiscordProviderUserIdFromClerkUser(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  const maybe = user as { externalAccounts?: unknown };
  if (!Array.isArray(maybe.externalAccounts)) return null;

  for (const acct of maybe.externalAccounts as unknown[]) {
    if (!acct || typeof acct !== "object") continue;
    const a = acct as ClerkExternalAccountLike;
    const provider = typeof a.provider === "string" ? a.provider.toLowerCase() : "";
    if (!provider.includes("discord")) continue;
    if (typeof a.providerUserId === "string" && a.providerUserId.length > 0) {
      return a.providerUserId;
    }
  }

  return null;
}

async function getClerkApi() {
  // In Clerk v6, `clerkClient` is an async function that returns the API client.
  // (At runtime, `clerkClient.users` is undefined unless you call it.)
  return await clerkClient();
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) return process.env.NEXT_PUBLIC_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
  }
  return "http://localhost:3000";
}

/**
 * Handles post-purchase onboarding for students and instructors.
 *
 * Triggered by: `purchase/instructor` (canonical) and `purchase/mentorship`
 * (deprecated alias — see PROJECT_STATUS.md → "Naming compliance — deprecated
 * aliases", target removal 2026-09-14).
 *
 * Skips guest purchases (no Clerk user to look up).
 *
 * Steps:
 * 1. Fetches order, payment, and session pack from Convex
 * 2. Looks up the instructor linked to the session pack
 * 3. Retrieves the student from Clerk by clerkId
 * 4. Persists Discord identity if student has connected Discord
 * 5. Looks up the instructor's Clerk user to get their email
 * 6. Checks if this is a returning student for the same instructor
 * 7. Sends a purchase onboarding email to the student (with Resend template or HTML fallback)
 * 8. Sends an instructor notification email about the new student
 * 9. Sends an admin notification email with purchase details
 * 10. Queues a Discord action to notify the instructor of the new signup
 *
 * @returns Object with success status, orderId, clerkId, sessionPackId, instructorId,
 *          discordConnected flag, and emailSent status
 */
export const onboardingFlow = inngest.createFunction(
  {
    id: "onboarding-flow",
    name: "Onboarding Flow",
    retries: 2,
  },
  [
    // Canonical trigger (PR 5 onward).
    { event: "purchase/instructor" },
    // Deprecated alias — kept alive for a 60-day window (target removal
    // 2026-09-14). See PROJECT_STATUS.md → "Naming compliance — deprecated
    // aliases" for the cleanup checklist.
    { event: "purchase/mentorship" },
  ],
  async ({ event, step }) => {
    // Normalise the deprecated alias so the strict schema always sees the
    // canonical name. Remove once the "purchase/mentorship" trigger is
    // cleaned up (target: 2026-09-14).
    const canonicalName =
      event.name === "purchase/mentorship" ? "purchase/instructor" : event.name;
    const parsed = purchaseInstructorEventSchema.parse({
      name: canonicalName,
      data: event.data,
    });

    const { orderId, clerkId, provider } = parsed.data;

    // Skip onboarding for guest purchases — no real Clerk user to look up.
    // The checkout flow already sends a generic Resend confirmation email.
    if (!clerkId || clerkId === "guest" || clerkId.startsWith("email:")) {
      return { success: true, skipped: true, reason: "guest user" };
    }

    const convex = getConvexClient();

    const order = await step.run("get-order", async () => {
      return await convex.query(api.orders.getOrderById, {
        id: orderId as Id<"orders">,
      });
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const payment = await step.run("get-completed-payment", async () => {
      return await convex.query(api.payments.getCompletedPaymentByOrderAndProvider, {
        orderId: orderId as Id<"orders">,
        provider: provider as "stripe" | "paypal",
      });
    });

    if (!payment) {
      throw new Error(`Completed payment not found for order ${orderId} (${provider})`);
    }

    const pack = await step.run("get-session-pack", async () => {
      return await convex.query(api.sessionPacks.getSessionPackByPaymentId, {
        paymentId: payment._id,
      });
    });

    if (!pack) {
      throw new Error(`Session pack not found for payment ${payment._id}`);
    }

    const instructor = await step.run("get-instructor", async () => {
      return await convex.query(api.instructors.getInstructorById, {
        id: pack.instructorId,
      });
    });

    if (!instructor) {
      throw new Error(`Instructor ${pack.instructorId} not found for session pack ${pack._id}`);
    }

    const clerkStudent = await step.run("get-student-clerk-user", async () => {
      const clerk = await getClerkApi();
      return await clerk.users.getUser(clerkId);
    });

    const studentEmail = clerkStudent.emailAddresses[0]?.emailAddress ?? null;
    if (!studentEmail) {
      throw new Error(`No email found for Clerk user ${clerkId}`);
    }

    const studentName =
      (clerkStudent.firstName ? `${clerkStudent.firstName}` : null) ??
      (clerkStudent.username ? `${clerkStudent.username}` : null);

    const discordId = getDiscordProviderUserIdFromClerkUser(clerkStudent);
    const discordConnected = Boolean(discordId);

    if (discordId) {
      await step.run("persist-discord-identity", async () => {
        return await convex.mutation(api.userIdentities.upsertUserIdentity, {
          userId: clerkId,
          provider: "discord",
          providerUserId: discordId,
        });
      });
    }

    const clerkInstructor = await step.run("get-instructor-clerk-user", async () => {
      const clerk = await getClerkApi();
      if (!instructor.userId) {
        throw new Error(`Instructor ${pack.instructorId} has no linked Clerk user`);
      }
      return await clerk.users.getUser(instructor.userId);
    });

    const instructorName =
      (clerkInstructor.firstName || clerkInstructor.lastName
        ? `${clerkInstructor.firstName ?? ""} ${clerkInstructor.lastName ?? ""}`.trim()
        : null) ?? clerkInstructor.username ?? "your instructor";

    const baseUrl = getBaseUrl();
    const dashboardUrl = `${baseUrl}/dashboard`;
    const onboardingUrl = `${baseUrl}/dashboard/onboarding`;
    const discordServerInviteUrl = process.env.DISCORD_SERVER_INVITE_URL || null;

    const useTemplates = process.env.EMAIL_USE_TEMPLATES === "true";
    const templateId = process.env.RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING;

    // Determine if this is a returning student for the same instructor
    const isReturning = await step.run("check-returning-student", async () => {
      try {
        const prior = await convex.query(api.sessionPacks.hasPriorPackWithInstructor, {
          userId: pack.userId,
          instructorId: instructor._id as Id<"instructors">,
          excludeSessionPackId: pack._id as Id<"sessionPacks">,
        });
        return Boolean(prior);
      } catch (e) {
        // Be forgiving; treat as not returning if query fails, but report for observability
        await reportError({
          source: "inngest:onboarding",
          error: e instanceof Error ? e : new Error(String(e)),
          level: "warn",
          message: "hasPriorPackWithInstructor failed",
          context: {
            phase: "check-returning-student",
            orderId,
            clerkId,
            sessionPackId: pack._id,
            instructorId: instructor._id,
          },
        });
        return false;
      }
    });

    const sendResult = await step.run("send-onboarding-email", async () => {
      if (useTemplates && templateId) {
        const templateData = {
          studentName: studentName ?? "",
          instructorName: instructorName,
          dashboardUrl,
          // Secondary link still provided for potential future use
          onboardingUrl,
          discordConnected,
          discordServerInviteUrl,
        } as const;
        return await sendTemplateEmail({
          to: studentEmail,
          templateId,
          subject: isReturning
            ? `Welcome back — your session pack with ${instructorName} is ready`
            : undefined,
          templateData,
          headers: {
            "X-Email-Type": "purchase_onboarding",
            "X-Order-Id": orderId,
            "X-Session-Pack-Id": pack._id,
            "X-Instructor-Id": instructor._id,
          },
        });
      }

      const emailContent = buildPurchaseOnboardingEmail({
        studentName,
        instructorName: instructorName,
        dashboardUrl,
        onboardingUrl,
        discordConnected,
        discordServerInviteUrl,
      });

      return await sendEmail({
        to: studentEmail,
        subject: isReturning
          ? `Welcome back — your session pack with ${instructorName} is ready`
          : emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: {
          ...emailContent.headers,
          "X-Order-Id": orderId,
          "X-Session-Pack-Id": pack._id,
          "X-Instructor-Id": instructor._id,
        },
      });
    });

    await step.run("report-onboarding-email-result", async () => {
      const wasSkipped = !sendResult.ok && "skipped" in sendResult && sendResult.skipped === true;
      await reportError({
        source: `inngest:${event.name}`,
        error: sendResult.ok ? null : sendResult,
        level: sendResult.ok ? "info" : wasSkipped ? "warn" : "error",
        message: sendResult.ok
          ? "Purchase onboarding email sent"
          : wasSkipped
            ? "Purchase onboarding email skipped (email not configured)"
            : "Purchase onboarding email failed",
        context: {
          orderId,
          clerkId,
          sessionPackId: pack._id,
          instructorId: instructor._id,
          discordConnected,
          resendId: sendResult.ok ? sendResult.id : null,
        },
      });
    });

    // Send instructor notification email (template-first)
    await step.run("send-instructor-email", async () => {
      // Get instructor's Clerk user to find their email
      const clerk = await getClerkApi();
      let instructorEmail: string | null = null;

      if (instructor.userId) {
        try {
          const instructorClerkUser = await clerk.users.getUser(instructor.userId);
          instructorEmail = instructorClerkUser.emailAddresses[0]?.emailAddress ?? null;
        } catch (error) {
          console.error("Failed to get instructor Clerk user:", error);
        }
      }

      if (!instructorEmail) {
        // Log warning but don't fail - instructor may need to add email
        console.warn(`No email found for instructor ${instructor._id} (userId: ${instructor.userId})`);
        return { sent: false, reason: "no_instructor_email" };
      }

      const dashboardUrl = `${baseUrl}/dashboard`;

      const useTemplates = process.env.EMAIL_USE_TEMPLATES === "true";
      const tmplId = process.env.RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE;

      if (useTemplates && tmplId) {
        const templateData = {
          instructorName,
          studentName,
          studentEmail,
          sessionCount: pack.totalSessions,
          dashboardUrl,
        } as const;
        const res = await sendTemplateEmail({
          to: instructorEmail,
          templateId: tmplId,
          subject: isReturning
            ? `Returning student — ${studentName || studentEmail || "A student"} has renewed`
            : undefined,
          templateData,
          headers: {
            "X-Email-Type": "instructor_purchase_notification",
            "X-Order-Id": orderId,
            "X-Session-Pack-Id": pack._id,
            "X-Instructor-Id": instructor._id,
          },
        });
        return { sent: res.ok, resendId: res.ok ? res.id : null };
      }

      const instructorEmailContent = buildInstructorOnboardingEmail({
        instructorName: instructorName,
        studentName: studentName,
        studentEmail: studentEmail,
        sessionsPurchased: pack.totalSessions,
        dashboardUrl,
      });

      const sendResult = await sendEmail({
        to: instructorEmail,
        subject: isReturning
          ? `Returning student — ${studentName || studentEmail || "A student"} has renewed`
          : instructorEmailContent.subject,
        html: instructorEmailContent.html,
        text: instructorEmailContent.text,
        headers: {
          ...instructorEmailContent.headers,
          "X-Order-Id": orderId,
          "X-Session-Pack-Id": pack._id,
          "X-Instructor-Id": instructor._id,
        },
      });

      return { sent: sendResult.ok, resendId: sendResult.ok ? sendResult.id : null };
    });

    await step.run("send-admin-email", async () => {
      const adminEmails = (process.env.ADMIN_EMAILS || "admin@huckleberry.art")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      if (adminEmails.length === 0) {
        return { sent: false, reason: "no_admin_emails_configured" };
      }

      const dashboardUrl = `${baseUrl}/admin`;

      const useTemplates = process.env.EMAIL_USE_TEMPLATES === "true";
      const adminTmplId = process.env.RESEND_TEMPLATE_ID_ADMIN_PURCHASE;

      if (useTemplates && adminTmplId) {
        const results = await Promise.all(
          adminEmails.map(async (adminEmail) => {
            const templateData = {
              orderId,
              studentName,
              studentEmail,
              instructorName,
              sessionCount: pack.totalSessions,
              purchaseAmount: order.totalAmount,
              currency: order.currency ?? "USD",
              paymentProvider: provider as "stripe" | "paypal",
              dashboardUrl,
            } as const;
            const res = await sendTemplateEmail({
              to: adminEmail,
              templateId: adminTmplId,
              subject: isReturning
                ? `[Returning] New session pack purchase - ${studentName || studentEmail} with ${instructorName}`
                : undefined,
              templateData,
              headers: {
                "X-Email-Type": "admin_purchase_notification",
                "X-Order-Id": orderId,
                "X-Session-Pack-Id": pack._id,
                "X-Instructor-Id": instructor._id,
              },
            });
            return res;
          })
        );
        const allSuccessful = results.every((r) => r.ok);
        return {
          sent: allSuccessful,
          recipients: adminEmails,
          results: results.map((r) => (r.ok ? { ok: true, id: r.id } : { ok: false, error: (r as any).error || "unknown" })),
        };
      }

      const adminEmailContent = buildAdminPurchaseEmail({
        orderId,
        studentName: studentName,
        studentEmail: studentEmail,
        instructorName: instructorName,
        sessionCount: pack.totalSessions,
        purchaseAmount: order.totalAmount,
        currency: order.currency ?? "USD",
        paymentProvider: provider as "stripe" | "paypal",
        dashboardUrl,
      });

      const sendResults = await Promise.all(
        adminEmails.map((adminEmail) =>
          sendEmail({
            to: adminEmail,
            subject: isReturning
              ? `[Returning] ${adminEmailContent.subject}`
              : adminEmailContent.subject,
            html: adminEmailContent.html,
            text: adminEmailContent.text,
            headers: {
              ...adminEmailContent.headers,
              "X-Order-Id": orderId,
              "X-Session-Pack-Id": pack._id,
              "X-Instructor-Id": instructor._id,
            },
          })
        )
      );

      const allSuccessful = sendResults.every((r) => r.ok);
      return {
        sent: allSuccessful,
        recipients: adminEmails,
        results: sendResults.map((r) => (r.ok ? { ok: true, id: r.id } : { ok: false, error: "error" in r ? r.error : "unknown" })),
      };
    });

await step.run("queue-discord-actions", async () => {
      // A lightweight "new purchase" DM can be sent later by the bot (once it's live).
      // Detailed DM with onboarding submission will be queued when the student completes the form.
      await convex.mutation(api.discordActionQueue.migrateDiscordAction, {
        type: "dm_instructor_new_signup",
        subjectUserId: clerkId,
        instructorId: instructor._id,
        instructorUserId: instructor.userId ?? undefined,
        payload: {
          kind: "purchase",
          orderId,
          sessionPackId: pack._id,
          dashboardUrl,
          onboardingUrl,
        },
      });

      // Role assignment discontinued: workspaces replace Discord roles.
      // We intentionally do not enqueue assign_student_role actions anymore.
    });

    return {
      success: true,
      orderId,
      clerkId,
      sessionPackId: pack._id,
      instructorId: instructor._id,
      discordConnected,
      emailSent: sendResult.ok,
    };
  }
);

// ============================================================
// PR admin-onboarding #3: live handler for `admin/onboarding.completed`.
//
// Replaces the PR 2 stub. Steps:
//   1. load-onboarding (shared-secret action)
//   2. send-student-email  (idempotent — guards on emailsSent.student)
//   3. send-instructor-emails (idempotent — guards on emailsSent.instructorIds)
//   4. send-admin-email (idempotent — guards on emailsSent.adminSummary)
//   5. enqueue-discord-dms (idempotent — migrateDiscordAction)
//   6. mark-completed (status + timeline)
//
// Catch handler: patches status="failed" + failureReason + timeline entry,
// then sends an admin digest email with the failure details.
//
// Idempotency: every step guards on the corresponding emailsSent flag so
// Inngest retries land on a no-op. The atomic expectedStatus +
// expectedAttemptCount guard on appendTimelineEntryAction prevents stale
// arrivals from corrupting the timeline.
// ============================================================
export const adminOnboardingFlow = inngest.createFunction(
  {
    id: "admin-onboarding-flow",
    name: "Admin Onboarding Flow",
    retries: 2,
  },
  { event: "admin/onboarding.completed" },
  async ({ event, step }) => {
    let parsed;
    try {
      parsed = adminOnboardingCompletedEventSchema.parse({
        name: event.name,
        data: event.data,
      });
    } catch (err) {
      throw new NonRetriableError(
        "admin/onboarding.completed event did not match schema: " +
          (err instanceof Error ? err.message : String(err))
      );
    }

    const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
    if (!secret) {
      throw new NonRetriableError(
        "CONVEX_SERVER_SHARED_SECRET is not set; admin onboarding flow cannot authenticate against Convex."
      );
    }

    const convex = getConvexClient();

    // PR 4: wrap the flow body in try/catch. Sidesteps the Turbopack
    // reserved-keyword issue with `catch: async ({ error }) => ...`
    // (the original PR 3 plan's approach). The catch fires AFTER Inngest's
    // `retries: 2` exhaustion: each step.run that throws triggers a flow
    // retry; once retries are exhausted, the final thrown error is
    // caught here, the row is flipped to `status: "failed"`, an admin
    // digest email is sent, and the run is returned with success: false.
    try {
      const row = await step.run("load-onboarding", async () => {
        return await convex.action(api.adminOnboarding.getAdminOnboardingAction, {
          id: parsed.data.onboardingId as Id<"adminOnboardings">,
          secret,
        });
      });

    if (!row) {
      await step.run("report-missing", async () => {
        await reportError({
          source: "inngest:admin-onboarding",
          error: null,
          level: "warn",
          message: "Admin onboarding: row not found, no-op",
          context: { onboardingId: parsed.data.onboardingId, attemptCount: parsed.data.attemptCount },
        });
      });
      return { skipped: true, reason: "missing" as const };
    }

    if (row.status !== "processing") {
      await step.run("report-terminal", async () => {
        await reportError({
          source: "inngest:admin-onboarding",
          error: null,
          level: "info",
          message: "Admin onboarding: row is " + row.status + ", no-op",
          context: { onboardingId: row._id, status: row.status, attemptCount: parsed.data.attemptCount },
        });
      });
      return { skipped: true, reason: "non_processing" as const, status: row.status };
    }

    const baseUrl = getBaseUrl();
    const dashboardUrl = baseUrl + "/dashboard";
    const studentEmail = row.email;
    const allRenewal =
      row.perInstructor.length > 0 && row.perInstructor.every(function(p: Doc<"adminOnboardings">["perInstructor"][number]) { return p.isRenewal; });
    const instructorCount = row.perInstructor.length;

    // ---- Step 2: send student email ----
    const studentEmailResult = await step.run("send-student-email", async function() {
      // PR 4 fix: re-fetch `emailsSent.student` from Convex so a
      // retry-after-partial-success doesn't re-send the student email.
      // PR 4 cloud-review fix (CodeRabbit #9234): also gate on the row's
      // current status + attemptCount. If a newer attempt is already
      // processing, or if the row has transitioned to a terminal state,
      // skip this step entirely.
      const freshRow = await convex.action(api.adminOnboarding.getAdminOnboardingAction, {
        id: row._id,
        secret,
      }) as Doc<"adminOnboardings"> | null;
      if (!freshRow) return { sent: false, skipped: "missing", id: null };
      if (freshRow.status !== "processing") return { sent: false, skipped: "non_processing", status: freshRow.status, id: null };
      if (freshRow.attemptCount !== parsed.data.attemptCount) return { sent: false, skipped: "attempt_mismatch", expected: parsed.data.attemptCount, actual: freshRow.attemptCount, id: null };
      const sent: boolean = (freshRow.emailsSent as any)?.student === true;
      if (sent) return { sent: true, skipped: false, id: null };

      const useTemplates = process.env.EMAIL_USE_TEMPLATES === "true";
      const templateId = process.env.RESEND_TEMPLATE_ID_PURCHASE_ONBOARDING;

      // PR 4 fix: look up instructor names via `getInstructorContactsAction`
      // so the email body shows the actual instructor name (previously
      // hardcoded to "" — Greptile P1).
      const contacts = await convex.action(api.adminOnboarding.getInstructorContactsAction, {
        instructorIds: row.perInstructor.map(function(p: Doc<"adminOnboardings">["perInstructor"][number]) { return p.instructorId; }),
        secret,
      });

      // All admin-onboarded workspaces link to the same dashboard page
      // (the platform doesn't have per-workspace routes — see
      // `apps/platform/app/dashboard/page.tsx`). Future PR may add
      // `/dashboard/workspaces/[id]` and use p.workspaceId here.
      const workspaceUrl = baseUrl + "/dashboard";

      const instructorNames = row.perInstructor.map(function(p: Doc<"adminOnboardings">["perInstructor"][number]) {
        return contacts[p.instructorId]?.name || "your instructor";
      });

      const templateData = {
        studentName: studentEmail.split("@")[0] ?? "",
        instructorName: instructorNames[0] ?? "your instructor",
        dashboardUrl,
        onboardingUrl: baseUrl + "/dashboard/onboarding",
        discordConnected: false,
        discordServerInviteUrl: null as string | null,
        isAdminOnboarded: true as boolean,
        isRenewal: allRenewal,
        instructorCount,
        instructorList: row.perInstructor.map(function(p: Doc<"adminOnboardings">["perInstructor"][number], i: number) {
          return { instructorName: instructorNames[i] ?? "your instructor", workspaceUrl };
        }),
      };

      // PR 4 cloud-review fix (CodeRabbit #9227): deterministic idempotency
      // key for Resend so a transient Convex-append failure after a
      // successful send doesn't trigger a duplicate delivery on retry.
      const idempotencyKey = "student:" + row._id;

      let res: any;
      if (useTemplates && templateId) {
        res = await sendTemplateEmail({
          to: studentEmail,
          templateId,
          subject: allRenewal
            ? "Welcome back — your instruction with " + instructorNames.join(", ") + " is ready"
            : undefined,
          templateData: templateData as Record<string, unknown>,
          headers: { "X-Email-Type": "admin_onboarding_student", "X-Onboarding-Id": row._id, "X-Idempotency-Key": idempotencyKey },
        });
      } else {
        const content = buildPurchaseOnboardingEmail(templateData);
        res = await sendEmail({
          to: studentEmail,
          subject: content.subject,
          html: content.html,
          text: content.text,
          headers: { ...content.headers, "X-Onboarding-Id": row._id, "X-Idempotency-Key": idempotencyKey },
        });
      }

      const ok = res.ok;
      const id: string | null = (ok && res.id) ? res.id : null;
      const skipped = !ok && "skipped" in res && res.skipped === true;

      // PR 4 cloud-review fix (CodeRabbit #9227): only mark `emailsSent.student`
      // as true when the provider actually delivered (ok or skipped-missing-config).
      // Failed deliveries should retry on the next attempt.
      const markSent = ok || skipped;
      if (markSent) {
        await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
          onboardingId: row._id,
          event: "email_sent",
          actorUserId: row.submittedByUserId,
          details: JSON.stringify({ recipient: "student", resendMessageId: id, skipped: skipped || undefined }),
          emailsSentPatch: { student: true },
          expectedStatus: "processing",
          expectedAttemptCount: parsed.data.attemptCount,
          secret,
        });
      } else {
        reportError({
          source: "inngest:admin-onboarding-flow",
          error: new Error("student email failed: " + ("error" in res ? res.error : "unknown")),
          level: "error",
          message: "Student onboarding email send failed — will retry on next attempt",
          context: { onboardingId: row._id },
        });
      }

      return { sent: ok, skipped, id };
    });

    // ---- Step 3: send instructor emails (one per assigned instructor) ----
    const instructorEmailResults = await step.run("send-instructor-emails", async function() {
      // PR 4 fix: re-fetch the current row from Convex at the start of
      // the step so `alreadySent` reflects the latest timeline state,
      // not the value captured at the original load-onboarding step.
      // Inngest replays memoized step results on retry, so `row` from
      // above is a stale snapshot. Without this re-fetch, a partial
      // failure mid-loop + retry would re-email instructors who were
      // already notified in the previous attempt.
      // PR 4 cloud-review fix (CodeRabbit #9234): also gate on the row's
      // current status + attemptCount.
      const freshRow = await convex.action(api.adminOnboarding.getAdminOnboardingAction, {
        id: row._id,
        secret,
      }) as Doc<"adminOnboardings"> | null;
      if (!freshRow) return { sent: 0, skipped: 0, failed: 0, noEmail: 0, reason: "missing" };
      if (freshRow.status !== "processing") return { sent: 0, skipped: 0, failed: 0, noEmail: 0, reason: "non_processing", status: freshRow.status };
      if (freshRow.attemptCount !== parsed.data.attemptCount) return { sent: 0, skipped: 0, failed: 0, noEmail: 0, reason: "attempt_mismatch", expected: parsed.data.attemptCount, actual: freshRow.attemptCount };
      const alreadySent: string[] = (freshRow.emailsSent as any)?.instructors ?? [];
      const toSend = freshRow.perInstructor.filter(function(p: Doc<"adminOnboardings">["perInstructor"][number]) {
        return !alreadySent.includes(p.instructorId as string);
      });
      if (toSend.length === 0) return { sent: 0, skipped: 0, failed: 0, noEmail: 0 };

      const useTemplates = process.env.EMAIL_USE_TEMPLATES === "true";
      const templateId = process.env.RESEND_TEMPLATE_ID_INSTRUCTOR_PURCHASE;

      // PR 4 fix: batched lookup of email + name for all to-send instructors.
      // One Convex round-trip instead of one per instructor.
      const contacts = await convex.action(api.adminOnboarding.getInstructorContactsAction, {
        instructorIds: toSend.map(function(p: Doc<"adminOnboardings">["perInstructor"][number]) { return p.instructorId; }),
        secret,
      });

      let sent = 0, skipped = 0, failed = 0, noEmail = 0;
      for (const pair of toSend) {
        const instructorIdStr = pair.instructorId as string;
        const contact = contacts[pair.instructorId];
        const instructorEmail = contact?.email ?? null;
        const instructorName = contact?.name ?? "Instructor";

        // If no resolvable email, record a skip event but still mark the
        // instructor as processed in `emailsSent.instructors` for idempotency.
        if (!instructorEmail) {
          noEmail++;
          await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
            onboardingId: row._id,
            event: "email_sent",
            actorUserId: row.submittedByUserId,
            details: JSON.stringify({ recipient: "instructor", instructorId: instructorIdStr, skipped: true, reason: contact?.reason ?? "no_email" }),
            emailsSentPatch: { instructors: [pair.instructorId as Id<"instructors">] },
            expectedStatus: "processing",
            expectedAttemptCount: parsed.data.attemptCount,
            secret,
          });
          continue;
        }

        const templateData = {
          instructorName,
          studentName: studentEmail.split("@")[0] ?? null,
          studentEmail: studentEmail,
          sessionsPurchased: pair.sessionsPerInstructor,
          dashboardUrl,
          isAdminOnboarded: true,
          isRenewal: pair.isRenewal,
        };

        // PR 4 cloud-review fix (CodeRabbit #9227): deterministic
        // idempotency key so a transient Convex-append failure after a
        // successful send doesn't trigger a duplicate delivery on retry.
        const idempotencyKey = "instructor:" + row._id + ":" + instructorIdStr;

        let res: any;
        if (useTemplates && templateId) {
          res = await sendTemplateEmail({
            to: instructorEmail,
            templateId,
            subject: pair.isRenewal
              ? "Renewal — " + studentEmail + " has renewed"
              : undefined,
            templateData: templateData as Record<string, unknown>,
            headers: { "X-Email-Type": "admin_onboarding_instructor", "X-Onboarding-Id": row._id, "X-Idempotency-Key": idempotencyKey },
          });
        } else {
          const content = buildInstructorOnboardingEmail(templateData);
          res = await sendEmail({
            to: instructorEmail,
            subject: content.subject,
            html: content.html,
            text: content.text,
            headers: { ...content.headers, "X-Onboarding-Id": row._id, "X-Idempotency-Key": idempotencyKey },
          });
        }

        const ok = res.ok;
        if (ok) sent++;
        else if (!ok && "skipped" in res && res.skipped) skipped++;
        else failed++;

        // PR 4 cloud-review fix (CodeRabbit #9227): only mark the
        // instructor as emailed when the provider actually delivered
        // (ok or skipped). Failed deliveries should retry on the next
        // attempt rather than being silently dropped.
        const markSent = ok || (!ok && "skipped" in res && res.skipped);
        if (markSent) {
          await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
            onboardingId: row._id,
            event: "email_sent",
            actorUserId: row.submittedByUserId,
            details: JSON.stringify({ recipient: "instructor", instructorId: instructorIdStr, resendMessageId: ok && res.id ? res.id : null, skipped: !ok && "skipped" in res ? true : undefined }),
            emailsSentPatch: { instructors: [pair.instructorId as Id<"instructors">] },
            expectedStatus: "processing",
            expectedAttemptCount: parsed.data.attemptCount,
            secret,
          });
        } else {
          reportError({
            source: "inngest:admin-onboarding-flow",
            error: new Error("instructor email failed: " + ("error" in res ? res.error : "unknown")),
            level: "error",
            message: "Instructor onboarding email send failed — will retry on next attempt",
            context: { onboardingId: row._id, instructorId: instructorIdStr },
          });
        }
      }
      return { sent, skipped, failed, noEmail };
    });

    // ---- Step 4: send admin summary email ----
    const adminEmailResult = await step.run("send-admin-email", async function() {
      // PR 4 cloud-review fix (greptile-apps): per-address tracking via
      // `emailsSent.adminSummaryByEmail`. We re-fetch the row so we know
      // which addresses already succeeded (and should be skipped on retry).
      // Only addresses that haven't succeeded are re-sent. After the run,
      // we merge the new results into `adminSummaryByEmail`. This avoids
      // both: (a) duplicate sends to already-successful addresses and
      // (b) permanent skip of failed addresses after one retry.
      // PR 4 cloud-review fix (CodeRabbit #9234): also gate on the row's
      // current status + attemptCount.
      const freshRow = await convex.action(api.adminOnboarding.getAdminOnboardingAction, {
        id: row._id,
        secret,
      }) as Doc<"adminOnboardings"> | null;
      if (!freshRow) return { sent: false, skipped: "missing", results: [] };
      if (freshRow.status !== "processing") return { sent: false, skipped: "non_processing", status: freshRow.status, results: [] };
      if (freshRow.attemptCount !== parsed.data.attemptCount) return { sent: false, skipped: "attempt_mismatch", expected: parsed.data.attemptCount, actual: freshRow.attemptCount, results: [] };
      const alreadyDelivered: Record<string, boolean> = (freshRow.emailsSent as any)?.adminSummaryByEmail ?? {};

      const adminEmails = (process.env.ADMIN_EMAILS || "admin@huckleberry.art")
        .split(",")
        .map(function(e: string) { return e.trim(); })
        .filter(Boolean);

      if (adminEmails.length === 0) return { sent: false, skipped: false, results: [] };

      const toSend = adminEmails.filter(function(e: string) { return alreadyDelivered[e] !== true; });
      if (toSend.length === 0) {
        return { sent: true, skipped: true, results: adminEmails.map(function(e: string) { return { email: e, ok: true }; }) };
      }

      const useTemplates = process.env.EMAIL_USE_TEMPLATES === "true";
      const templateId = process.env.RESEND_TEMPLATE_ID_ADMIN_PURCHASE;

      // PR 4 fix: look up instructor names so the admin summary table shows
      // the actual instructor name per row (previously hardcoded to "").
      const contacts = await convex.action(api.adminOnboarding.getInstructorContactsAction, {
        instructorIds: row.perInstructor.map(function(p: Doc<"adminOnboardings">["perInstructor"][number]) { return p.instructorId; }),
        secret,
      });
      const instructorNames = row.perInstructor.map(function(p: Doc<"adminOnboardings">["perInstructor"][number]) {
        return contacts[p.instructorId]?.name ?? "";
      });

      const perInstructorRows = row.perInstructor.map(function(p: Doc<"adminOnboardings">["perInstructor"][number], i: number) {
        const expiresAtStr = p.expiresAt
          ? new Date(p.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
          : undefined;
        return {
          instructorName: instructorNames[i] ?? "",
          isRenewal: p.isRenewal,
          workspaceUrl: baseUrl + "/dashboard",
          sessionsCount: p.sessionsPerInstructor,
          expirationDate: expiresAtStr,
          clerkInvitationId: p.clerkInvitationId,
        };
      });

      const templateData = {
        orderId: undefined as string | undefined,
        studentName: studentEmail.split("@")[0] ?? null,
        studentEmail,
        instructorName: instructorNames.filter(Boolean).join(", "),
        sessionCount: row.perInstructor.reduce(function(s: number, p: Doc<"adminOnboardings">["perInstructor"][number]) { return s + p.sessionsPerInstructor; }, 0),
        dashboardUrl: baseUrl + "/admin",
        isAdminOnboarded: true,
        instructorCount,
        perInstructorRows,
      };

      // PR 4 cloud-review fix: each send attempted independently with
      // its own try/catch so one transient Resend failure does not block
      // the others (this matches the same pattern used in the stale-digest
      // cron and the catch handler's admin-failure-digest send).
      // PR 4 cloud-review fix (CodeRabbit #9227): deterministic
      // idempotency key per (onboarding, admin-email) so a transient
      // Convex-append failure after a successful send doesn't trigger a
      // duplicate delivery on retry.
      const newResults: Array<{ email: string; ok: boolean; id?: string | null }> = [];
      await Promise.all(toSend.map(async function(adminEmail: string) {
        let res: any;
        try {
          const idempotencyKey = "admin:" + row._id + ":" + adminEmail;
          if (useTemplates && templateId) {
            res = await sendTemplateEmail({
              to: adminEmail,
              templateId,
              subject: "Kajabi admin onboarding — " + studentEmail + " \u00d7 " + instructorCount + " instructor" + (instructorCount > 1 ? "s" : ""),
              templateData: templateData as Record<string, unknown>,
              headers: { "X-Email-Type": "admin_onboarding_summary", "X-Onboarding-Id": row._id, "X-Idempotency-Key": idempotencyKey },
            });
          } else {
            const content = buildAdminPurchaseEmail(templateData);
            res = await sendEmail({
              to: adminEmail,
              subject: content.subject,
              html: content.html,
              text: content.text,
              headers: { ...content.headers, "X-Onboarding-Id": row._id, "X-Idempotency-Key": idempotencyKey },
            });
          }
          // PR 4 cloud-review fix (CodeRabbit #9221): report when the
          // provider accepted the request but the delivery itself failed.
          if (!res.ok) {
            reportError({
              source: "inngest:admin-onboarding-flow",
              error: new Error("sendEmail returned ok:false: " + ("error" in res ? res.error : "skipped" in res ? res.reason : "unknown")),
              level: "error",
              message: "Admin onboarding summary send reported non-ok result for " + adminEmail,
              context: { onboardingId: row._id },
            });
          }
          newResults.push({ email: adminEmail, ok: res.ok, id: res.ok && res.id ? res.id : null });
        } catch (e: unknown) {
          reportError({
            source: "inngest:admin-onboarding-flow",
            error: e instanceof Error ? e : new Error(String(e)),
            level: "error",
            message: "Failed to send admin onboarding summary to " + adminEmail,
            context: { onboardingId: row._id },
          });
          newResults.push({ email: adminEmail, ok: false });
        }
      }));

      const updatedByEmail: Record<string, boolean> = {};
      for (const r of newResults) updatedByEmail[r.email] = r.ok;
      const mergedByEmail: Record<string, boolean> = { ...alreadyDelivered, ...updatedByEmail };
      const allOk = adminEmails.every(function(e: string) { return mergedByEmail[e] === true; });
      const anyOk = adminEmails.some(function(e: string) { return mergedByEmail[e] === true; });

      // Record the per-address results in the timeline and merge into
      // `adminSummaryByEmail` so future retries skip the successful ones.
      await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
        onboardingId: row._id,
        event: "email_sent",
        actorUserId: row.submittedByUserId,
        details: JSON.stringify({
          recipient: "admin",
          count: adminEmails.length,
          attempted: toSend.length,
          allOk,
          anyOk,
          perAddress: adminEmails.map(function(e: string) { return { email: e, ok: mergedByEmail[e] === true }; }),
        }),
        emailsSentPatch: { adminSummaryByEmail: mergedByEmail },
        expectedStatus: "processing",
        expectedAttemptCount: parsed.data.attemptCount,
        secret,
      });

      return { sent: allOk, skipped: false, results: adminEmails.map(function(e: string) { return { email: e, ok: mergedByEmail[e] === true }; }) };
    });

    // ---- Step 5: enqueue Discord DMs ----
    await step.run("enqueue-discord-dms", async function() {
      const placeholderUserId = "email:" + studentEmail;
      for (const pair of row.perInstructor) {
        await convex.mutation(api.discordActionQueue.migrateDiscordAction, {
          type: "dm_instructor_new_signup",
          subjectUserId: placeholderUserId,
          instructorId: pair.instructorId as string,
          instructorUserId: undefined,
          payload: {
            kind: "admin_onboarding",
            onboardingId: row._id,
            dashboardUrl,
          },
        });
      }
      await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
        onboardingId: row._id,
        event: "discord_queued",
        actorUserId: row.submittedByUserId,
        details: "Discord DM enqueued for " + row.perInstructor.length + " instructor(s)",
        expectedStatus: "processing",
        expectedAttemptCount: parsed.data.attemptCount,
        secret,
      });
    });

    // ---- Step 6: mark completed ----
    await step.run("mark-completed", async function() {
      await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
        onboardingId: row._id,
        event: "completed",
        actorUserId: row.submittedByUserId,
        details: "Admin onboarding flow completed successfully",
        expectedStatus: "processing",
        expectedAttemptCount: parsed.data.attemptCount,
        secret,
      });
    });

    return {
      success: true,
      onboardingId: row._id,
      studentEmailSent: studentEmailResult.sent,
      instructorEmails: instructorEmailResults,
      adminEmailSent: adminEmailResult.sent,
    };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const onboardingId = parsed.data.onboardingId as Id<"adminOnboardings">;
      const baseUrl = getBaseUrl();
      const adminDashboardUrl = baseUrl + "/admin/onboardings/" + onboardingId;

      // PR 4 cloud-review fixes:
      //  - expectedStatus/expectedAttemptCount now GUARD on "processing" +
      //    parsed.data.attemptCount so an exhausted retry cannot overwrite
      //    a later completed attempt back to "failed". If the row has
      //    already been transitioned (completed/failed), the guard throws
      //    "stale call rejected" — we catch that.
      //  - PR 4 cloud-review fix (CodeRabbit #9266): distinguish
      //    "newer attempt owns processing" (suppress digest) from
      //    "row already terminal" (send digest — informational). Re-fetch
      //    the row when "stale call rejected" fires.
      //  - PR 4 cloud-review fix (CodeRabbit #9271): the admin failure
      //    digest MUST be sent BEFORE rethrowing NonRetriableError so
      //    admins get notified precisely when mark-failed couldn't
      //    transition the row out of processing.
      let suppressDigest = false;
      let markFailedExhausted = false;
      try {
        await step.run("mark-failed", async () => {
          await convex.action(api.adminOnboarding.appendTimelineEntryAction, {
            onboardingId,
            event: "failed",
            actorUserId: undefined,
            details: reason,
            expectedStatus: "processing",
            expectedAttemptCount: parsed.data.attemptCount,
            secret,
          });
        });
      } catch (markErr) {
        const msg = markErr instanceof Error ? markErr.message : String(markErr);
        if (msg.includes("stale call rejected")) {
          // Re-fetch the row to determine whether this is a genuine
          // terminal row (completed/failed/cancelled) or a newer attempt
          // that owns processing.
          let newerAttemptInFlight = false;
          try {
            const freshRow = await convex.action(api.adminOnboarding.getAdminOnboardingAction, {
              id: onboardingId,
              secret,
            }) as Doc<"adminOnboardings"> | null;
            newerAttemptInFlight =
              !!freshRow &&
              freshRow.status === "processing" &&
              freshRow.attemptCount > parsed.data.attemptCount;
          } catch (refreshErr) {
            // Couldn't determine — fall through to "send digest" (safe default).
          }
          if (newerAttemptInFlight) {
            // Suppress digest — newer run owns state and will report its
            // own outcome. Don't double-notify admins.
            suppressDigest = true;
            reportError({
              source: "inngest:admin-onboarding-flow",
              error: markErr instanceof Error ? markErr : new Error(msg),
              level: "warn",
              message: "mark-failed suppressed: newer attempt (attemptCount > " + parsed.data.attemptCount + ") owns processing — digest suppressed",
              context: { onboardingId, reason: msg },
            });
          } else {
            // Row is genuinely terminal — admin digest is still useful
            // (informational). Don't bubble; fall through.
            reportError({
              source: "inngest:admin-onboarding-flow",
              error: markErr instanceof Error ? markErr : new Error(msg),
              level: "warn",
              message: "mark-failed no-op: row already terminal — admin digest still sent",
              context: { onboardingId, reason: msg },
            });
          }
        } else {
          // Real Convex/network failure after retries exhausted. Capture
          // the failure but DON'T throw yet — send the digest first.
          markFailedExhausted = true;
          reportError({
            source: "inngest:admin-onboarding-flow",
            error: markErr instanceof Error ? markErr : new Error(msg),
            level: "error",
            message: "Failed to mark onboarding as failed in Convex — will bubble NonRetriableError after digest",
            context: { onboardingId },
          });
        }
      }

      // Best-effort: send an admin digest email with the failure reason
      // and a deep-link to the recovery dashboard. Suppressed when a
      // newer attempt owns processing (see CodeRabbit #9266 above).
      if (!suppressDigest) {
        try {
          await step.run("send-admin-failure-digest", async () => {
            const adminEmails = (process.env.ADMIN_EMAILS || "admin@huckleberry.art")
              .split(",")
              .map(function(e: string) { return e.trim(); })
              .filter(Boolean);
            const subject = "[Admin Onboarding] FAILED — " + onboardingId;
            const html =
              "<div style=\"font-family:ui-sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827\">" +
              "<div style=\"font-size:18px;font-weight:700;color:#B91C1C;margin-bottom:12px\">Admin onboarding flow failed</div>" +
              "<div style=\"padding:16px;border:1px solid #FCA5A5;border-radius:12px;background:#FEF2F2\">" +
              "<div style=\"margin-bottom:8px\"><strong>Onboarding:</strong> " + onboardingId + "</div>" +
              "<div style=\"margin-bottom:8px\"><strong>Error:</strong> <code style=\"font-family:ui-monospace\">" + reason.replace(/</g, "&lt;") + "</code></div>" +
              "<div style=\"margin-top:12px\"><a href=\"" + adminDashboardUrl + "\" style=\"background:#111;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none\">View in recovery dashboard</a></div>" +
              "</div></div>";
            const text =
              "Admin onboarding flow failed\n" +
              "Onboarding: " + onboardingId + "\n" +
              "Error: " + reason + "\n" +
              "Recovery dashboard: " + adminDashboardUrl;
            // PR 4 fix: await each sendEmail so the step only resolves after
            // all sends have completed. Errors are caught per-recipient.
            // PR 4 cloud-review fix (CodeRabbit #9221): also report when
            // sendEmail returns ok:false (provider accepted but delivery failed).
            await Promise.all(adminEmails.map(async function(adminEmail: string) {
              try {
                const res = await sendEmail({
                  to: adminEmail,
                  subject,
                  html,
                  text,
                  headers: { "X-Email-Type": "admin_onboarding_failure_digest" },
                });
                if (!res.ok) {
                  reportError({
                    source: "inngest:admin-onboarding-flow",
                    error: new Error("sendEmail returned ok:false: " + ("error" in res ? res.error : "skipped" in res ? res.reason : "unknown")),
                    level: "error",
                    message: "Admin failure digest reported non-ok result for " + adminEmail,
                    context: { onboardingId },
                  });
                }
              } catch (e: unknown) {
                reportError({
                  source: "inngest:admin-onboarding-flow",
                  error: e instanceof Error ? e : new Error(String(e)),
                  level: "error",
                  message: "Failed to send admin failure digest to " + adminEmail,
                  context: { onboardingId },
                });
              }
            }));
          });
        } catch (digestErr) {
          reportError({
            source: "inngest:admin-onboarding-flow",
            error: digestErr instanceof Error ? digestErr : new Error(String(digestErr)),
            level: "error",
            message: "Failed to send admin failure digest step",
            context: { onboardingId },
          });
        }
      }

      // NOW (after digest has been sent) bubble NonRetriableError so
      // Inngest marks this run as failed. Without this, the run returns
      // normally and the row could remain in "processing" forever.
      if (markFailedExhausted) {
        throw new NonRetriableError(
          "adminOnboardingFlow: failed to mark onboarding as failed in Convex: " + reason
        );
      }

      return {
        success: false,
        onboardingId,
        reason,
      };
    }
  },
  );
