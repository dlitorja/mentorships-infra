import { clerkClient } from "@clerk/nextjs/server";
import {
  and,
  db,
  desc,
  discordActionQueue,
  getMentorById,
  getOrderById,
  payments,
  sessionPacks,
  userIdentities,
  users,
  eq,
} from "@mentorships/db";
import { sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";
import { buildPurchaseOnboardingEmail } from "@/lib/emails/purchase-onboarding-email";
import { purchaseMentorshipEventSchema } from "../types";
import { inngest } from "../client";

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

    const order = await step.run("get-order", async () => {
      return await getOrderById(orderId);
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const payment = await step.run("get-completed-payment", async () => {
      const [p] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, "completed"), eq(payments.provider, provider)))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      return p ?? null;
    });

    if (!payment) {
      throw new Error(`Completed payment not found for order ${orderId} (${provider})`);
    }

    const pack = await step.run("get-session-pack", async () => {
      const [p] = await db
        .select()
        .from(sessionPacks)
        .where(eq(sessionPacks.paymentId, payment.id))
        .limit(1);
      return p ?? null;
    });

    if (!pack) {
      throw new Error(`Session pack not found for payment ${payment.id}`);
    }

    const mentor = await step.run("get-mentor", async () => {
      return await getMentorById(pack.mentorId);
    });

    if (!mentor) {
      throw new Error(`Mentor ${pack.mentorId} not found for session pack ${pack.id}`);
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
        const existing = await db
          .select()
          .from(userIdentities)
          .where(and(eq(userIdentities.userId, clerkId), eq(userIdentities.provider, "discord")))
          .limit(1);

        if (existing.length > 0) return;

        await db.insert(userIdentities).values({
          userId: clerkId,
          provider: "discord",
          providerUserId: discordId,
        });
      });
    }

    const clerkMentor = await step.run("get-mentor-clerk-user", async () => {
      const clerk = await getClerkApi();
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
          "X-Session-Pack-Id": pack.id,
          "X-Mentor-Id": mentor.id,
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
          sessionPackId: pack.id,
          mentorId: mentor.id,
          discordConnected,
          resendId: sendResult.ok ? sendResult.id : null,
        },
      });
    });

    await step.run("queue-discord-actions", async () => {
      // A lightweight “new purchase” DM can be sent later by the bot (once it’s live).
      // Detailed DM with onboarding submission will be queued when the mentee completes the form.
      await db.insert(discordActionQueue).values({
        type: "dm_instructor_new_signup",
        status: "pending",
        subjectUserId: clerkId,
        mentorId: mentor.id,
        mentorUserId: mentor.userId,
        payload: {
          kind: "purchase",
          orderId,
          sessionPackId: pack.id,
          dashboardUrl,
          onboardingUrl,
        },
      });

      if (discordId) {
        await db.insert(discordActionQueue).values({
          type: "assign_mentee_role",
          status: "pending",
          subjectUserId: clerkId,
          mentorId: mentor.id,
          mentorUserId: mentor.userId,
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
      sessionPackId: pack.id,
      mentorId: mentor.id,
      discordConnected,
      emailSent: sendResult.ok,
    };
  }
);


