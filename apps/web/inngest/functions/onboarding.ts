import { clerkClient } from "@clerk/nextjs/server";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "../../../../convex/_generated/dataModel";
import { sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";
import { buildPurchaseOnboardingEmail } from "@/lib/emails/purchase-onboarding-email";
import { buildInstructorOnboardingEmail } from "@/lib/emails/instructor-onboarding-email";
import { buildAdminPurchaseEmail } from "@/lib/emails/admin-purchase-notification-email";
import { purchaseMentorshipEventSchema } from "../types";
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

export const onboardingFlow = inngest.createFunction(
  {
    id: "onboarding-flow",
    name: "Onboarding Flow",
    retries: 2,
  },
  { event: "purchase/mentorship" },
  async ({ event, step }) => {
    const parsed = purchaseMentorshipEventSchema.parse({
      name: event.name,
      data: event.data,
    });

    const { orderId, clerkId, provider } = parsed.data;
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

    const mentor = await step.run("get-mentor", async () => {
      return await convex.query(api.instructors.getInstructorById, {
        id: pack.mentorId,
      });
    });

    if (!mentor) {
      throw new Error(`Mentor ${pack.mentorId} not found for session pack ${pack._id}`);
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

    const clerkMentor = await step.run("get-mentor-clerk-user", async () => {
      const clerk = await getClerkApi();
      if (!mentor.userId) {
        throw new Error(`Instructor ${pack.mentorId} has no linked Clerk user`);
      }
      return await clerk.users.getUser(mentor.userId);
    });

    const mentorName =
      (clerkMentor.firstName || clerkMentor.lastName
        ? `${clerkMentor.firstName ?? ""} ${clerkMentor.lastName ?? ""}`.trim()
        : null) ?? clerkMentor.username ?? "your instructor";

    const baseUrl = getBaseUrl();
    const dashboardUrl = `${baseUrl}/dashboard`;
    const onboardingUrl = `${baseUrl}/dashboard/onboarding`;
    const discordServerInviteUrl = process.env.DISCORD_SERVER_INVITE_URL || null;

    const emailContent = buildPurchaseOnboardingEmail({
      studentName,
      instructorName: mentorName,
      dashboardUrl,
      onboardingUrl,
      discordConnected,
      discordServerInviteUrl,
    });

    const sendResult = await step.run("send-onboarding-email", async () => {
      return await sendEmail({
        to: studentEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: {
          ...emailContent.headers,
          "X-Order-Id": orderId,
          "X-Session-Pack-Id": pack._id,
          "X-Mentor-Id": mentor._id,
        },
      });
    });

    await step.run("report-onboarding-email-result", async () => {
      const wasSkipped = !sendResult.ok && "skipped" in sendResult && sendResult.skipped === true;
      await reportError({
        source: "inngest:purchase/mentorship",
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
          mentorId: mentor._id,
          discordConnected,
          resendId: sendResult.ok ? sendResult.id : null,
        },
      });
    });

    // Send instructor notification email
    await step.run("send-instructor-email", async () => {
      // Get instructor's Clerk user to find their email
      const clerk = await getClerkApi();
      let instructorEmail: string | null = null;

      if (mentor.userId) {
        try {
          const instructorClerkUser = await clerk.users.getUser(mentor.userId);
          instructorEmail = instructorClerkUser.emailAddresses[0]?.emailAddress ?? null;
        } catch (error) {
          console.error("Failed to get instructor Clerk user:", error);
        }
      }

      if (!instructorEmail) {
        // Log warning but don't fail - instructor may need to add email
        console.warn(`No email found for instructor ${mentor._id} (userId: ${mentor.userId})`);
        return { sent: false, reason: "no_instructor_email" };
      }

      const dashboardUrl = `${baseUrl}/dashboard`;

      const instructorEmailContent = buildInstructorOnboardingEmail({
        instructorName: mentorName,
        studentName: studentName,
        studentEmail: studentEmail,
        sessionsPurchased: pack.totalSessions,
        dashboardUrl,
      });

      const sendResult = await sendEmail({
        to: instructorEmail,
        subject: instructorEmailContent.subject,
        html: instructorEmailContent.html,
        text: instructorEmailContent.text,
        headers: {
          ...instructorEmailContent.headers,
          "X-Order-Id": orderId,
          "X-Session-Pack-Id": pack._id,
          "X-Mentor-Id": mentor._id,
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

      const adminEmailContent = buildAdminPurchaseEmail({
        orderId,
        studentName: studentName,
        studentEmail: studentEmail,
        instructorName: mentorName,
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
            subject: adminEmailContent.subject,
            html: adminEmailContent.html,
            text: adminEmailContent.text,
            headers: {
              ...adminEmailContent.headers,
              "X-Order-Id": orderId,
              "X-Session-Pack-Id": pack._id,
              "X-Mentor-Id": mentor._id,
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
      // Detailed DM with onboarding submission will be queued when the mentee completes the form.
      await convex.mutation(api.discordActionQueue.migrateDiscordAction, {
        type: "dm_instructor_new_signup",
        subjectUserId: clerkId,
        mentorId: mentor._id,
        mentorUserId: mentor.userId ?? undefined,
        payload: {
          kind: "purchase",
          orderId,
          sessionPackId: pack._id,
          dashboardUrl,
          onboardingUrl,
        },
      });

      if (discordId) {
        await convex.mutation(api.discordActionQueue.migrateDiscordAction, {
          type: "assign_mentee_role",
          subjectUserId: clerkId,
          mentorId: mentor._id,
          mentorUserId: mentor.userId ?? undefined,
          payload: {
            discordId,
            guildId: process.env.DISCORD_GUILD_ID ?? null,
            roleName: process.env.DISCORD_MENTEE_ROLE_NAME ?? null,
          },
        });
      }
    });

    return {
      success: true,
      orderId,
      clerkId,
      sessionPackId: pack._id,
      mentorId: mentor._id,
      discordConnected,
      emailSent: sendResult.ok,
    };
  }
);


