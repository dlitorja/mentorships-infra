import { z } from "zod";
import { inngest } from "../client";
import {
  and,
  claimDiscordActions,
  db,
  eq,
  markDiscordActionDone,
  markDiscordActionFailed,
  setDiscordActionStatus,
  userIdentities,
} from "@mentorships/db";
import { reportError } from "@/lib/observability";
import { DiscordApiError, addGuildMemberRoleByName, addGuildMemberRole, sendDm } from "@/lib/discord";

const assignMenteeRolePayloadSchema = z.object({
  discordId: z.string().min(1),
  guildId: z.string().min(1).nullable().optional(),
  roleName: z.string().min(1).nullable().optional(),
  roleId: z.string().min(1).nullable().optional(),
});

const dmInstructorNewSignupPayloadSchema = z.object({
  kind: z.literal("purchase"),
  orderId: z.string().uuid(),
  sessionPackId: z.string().uuid(),
  dashboardUrl: z.string().url(),
  onboardingUrl: z.string().url(),
});

function getDiscordIdentityForUserId(userId: string): Promise<string | null> {
  return db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, "discord")))
    .limit(1)
    .then((rows) => rows[0]?.providerUserId ?? null);
}

export const processDiscordActionQueue = inngest.createFunction(
  {
    id: "process-discord-action-queue",
    name: "Process Discord Action Queue",
    retries: 1,
  },
  { cron: "*/1 * * * *" }, // every minute
  async ({ step }) => {
    const actions = await step.run("claim-discord-actions", async () => {
      return await claimDiscordActions({ limit: 25, lockTtlMs: 10 * 60 * 1000 });
    });

    let processed = 0;
    let done = 0;
    let failed = 0;
    let requeued = 0;

    for (const action of actions) {
      processed += 1;

      await step.run(`process-${action.id}`, async () => {
        try {
          if (action.type === "assign_mentee_role") {
            const payload = assignMenteeRolePayloadSchema.parse(action.payload);
            const guildId = payload.guildId ?? process.env.DISCORD_GUILD_ID ?? null;

            if (!guildId) {
              throw new Error("Missing guildId for assign_mentee_role");
            }

            if (payload.roleId && payload.roleId.trim().length > 0) {
              await addGuildMemberRole({
                guildId,
                discordUserId: payload.discordId,
                roleId: payload.roleId,
              });
            } else {
              const roleName = payload.roleName ?? process.env.DISCORD_MENTEE_ROLE_NAME ?? null;
              if (!roleName) {
                throw new Error("Missing roleName for assign_mentee_role");
              }
              await addGuildMemberRoleByName({
                guildId,
                discordUserId: payload.discordId,
                roleName,
              });
            }

            await markDiscordActionDone(action.id);
            done += 1;
            return;
          }

          if (action.type === "dm_instructor_new_signup") {
            const payload = dmInstructorNewSignupPayloadSchema.parse(action.payload);

            if (!action.mentorUserId) {
              throw new Error("Missing mentorUserId for dm_instructor_new_signup");
            }

            const mentorDiscordId = await getDiscordIdentityForUserId(action.mentorUserId);
            if (!mentorDiscordId) {
              throw new Error("Mentor Discord identity not connected");
            }

            const content =
              `New signup:\n\n` +
              `- Order: ${payload.orderId}\n` +
              `- Session pack: ${payload.sessionPackId}\n\n` +
              `Dashboard: ${payload.dashboardUrl}\n` +
              `Onboarding: ${payload.onboardingUrl}`;

            await sendDm({ discordUserId: mentorDiscordId, content });

            await markDiscordActionDone(action.id);
            done += 1;
            return;
          }

          // Unknown action type (future-proof)
          throw new Error(`Unsupported Discord action type: ${action.type}`);
        } catch (err) {
          // Retry on transient Discord errors by re-queueing.
          if (err instanceof DiscordApiError && (err.status === 429 || err.status >= 500)) {
            await setDiscordActionStatus({
              id: action.id,
              status: "pending",
              lockedAt: null,
              lastError: `${err.name}: ${err.message}`.slice(0, 2000),
            });
            requeued += 1;
            return;
          }

          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          await markDiscordActionFailed({ id: action.id, error: errorMessage });
          failed += 1;
        }
      });
    }

    await step.run("report-discord-queue-run", async () => {
      await reportError({
        source: "inngest:discord_action_queue",
        error: null,
        level: processed === 0 ? "info" : failed > 0 ? "warn" : "info",
        message: "Processed discord_action_queue",
        context: {
          processed,
          done,
          failed,
          requeued,
        },
      });
    });

    return { success: true, processed, done, failed, requeued };
  }
);


