import { mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const LOCK_TTL_MS = 10 * 60 * 1000;
const ENQUEUE_DELAY_MS = 5 * 1000;
const DRAIN_DELAY_MS = 5 * 60 * 1000;

/**
 * Migrates a Discord action queue entry from legacy system.
 * Updates existing entry if found by subjectUserId, otherwise creates new.
 * When the queue transitions from empty to having a pending action, a
 * processor run is scheduled so the cron is only a catch-up safety net.
 */
export const migrateDiscordAction = mutation({
  args: {
    type: v.union(
      v.literal("assign_student_role"),
      v.literal("dm_instructor_new_signup")
    ),
    subjectUserId: v.string(),
    instructorId: v.optional(v.string()),
    instructorUserId: v.optional(v.string()),
    payload: v.optional(v.any()),
    status: v.optional(v.union(v.literal("pending"), v.literal("processing"), v.literal("done"), v.literal("failed"))),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lockedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingBySubjectUserId = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_subjectUserId", (q) =>
        q.eq("subjectUserId", args.subjectUserId)
      )
      .first();

    async function scheduleProcessorIfIdle() {
      const wasEligible = await ctx.runQuery(
        internal.discordActionQueue.hasEligibleDiscordActions,
        { lockTtlMs: LOCK_TTL_MS }
      );
      if (!wasEligible) {
        await ctx.scheduler.runAfter(
          ENQUEUE_DELAY_MS,
          internal.discordActionQueue.processDiscordActionQueue,
          {}
        );
      }
    }

    if (existingBySubjectUserId) {
      const updates: Record<string, unknown> = {};
      if (args.type) updates.type = args.type;
      if (args.instructorId !== undefined) updates.instructorId = args.instructorId;
      if (args.instructorUserId !== undefined) updates.instructorUserId = args.instructorUserId;
      if (args.payload !== undefined) updates.payload = args.payload;
      if (args.status) updates.status = args.status;
      if (args.attempts !== undefined) updates.attempts = args.attempts;
      if (args.lastError !== undefined) updates.lastError = args.lastError;
      if (args.lockedAt !== undefined) updates.lockedAt = args.lockedAt;
      if (args.updatedAt) updates.updatedAt = args.updatedAt;

      const finalStatus =
        (args.status as string | undefined) ??
        (existingBySubjectUserId.status as string) ??
        "pending";

      if (Object.keys(updates).length > 0) {
        if (finalStatus === "pending") {
          await scheduleProcessorIfIdle();
        }
        await ctx.db.patch(existingBySubjectUserId._id, updates);
      }
      return { action: "updated", id: existingBySubjectUserId._id };
    }

    const finalStatus = (args.status as string | undefined) ?? "pending";
    if (finalStatus === "pending") {
      await scheduleProcessorIfIdle();
    }

    const insertResult = await ctx.db.insert("discordActionQueue", {
      // Temporary cast to handle legacy codegen environments that still reference
      // "assign_mentee_role" in the enum. Server schema supports "assign_student_role".
      type: args.type as any,
      subjectUserId: args.subjectUserId,
      instructorId: args.instructorId ?? undefined,
      instructorUserId: args.instructorUserId ?? undefined,
      payload: args.payload ?? undefined,
      status: args.status ?? "pending",
      attempts: args.attempts ?? 0,
      lastError: args.lastError ?? undefined,
      lockedAt: args.lockedAt ?? undefined,
      createdAt: args.createdAt ?? Date.now(),
      updatedAt: args.updatedAt ?? Date.now(),
    });

    return { action: "inserted", id: insertResult };
  },
});

/**
 * Claims pending Discord actions for processing with row-level locking.
 * Returns up to `limit` pending or stale processing actions.
 *
 * For DM actions, the instructor's Discord providerUserId is looked up
 * inline during the claim so the processor can avoid a separate round
 * trip to Convex per DM action.
 * Internal use only.
 */
export const claimDiscordActions = internalMutation({
  args: {
    limit: v.number(),
    lockTtlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lockThreshold = now - args.lockTtlMs;

    const pendingActions = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(args.limit);

    const staleProcessingActions = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .filter((q) => q.lt(q.field("lockedAt"), lockThreshold))
      .order("asc")
      .take(args.limit);

    const actionsToClaim = [...pendingActions, ...staleProcessingActions];

    const claimed: Array<{
      id: string;
      type: "assign_student_role" | "dm_instructor_new_signup";
      status: string;
      subjectUserId: string;
      instructorId: string | null;
      instructorUserId: string | null;
      instructorDiscordId: string | null;
      payload: unknown;
      attempts: number;
      lastError: string | null;
      lockedAt: number;
    }> = [];

    for (const action of actionsToClaim) {
      let instructorDiscordId: string | null = null;
      if (action.type === "dm_instructor_new_signup" && action.instructorUserId) {
        const instructorUserId = action.instructorUserId;
        const identity = await ctx.db
          .query("userIdentities")
          .withIndex("by_userId_provider", (q) =>
            q.eq("userId", instructorUserId).eq("provider", "discord")
          )
          .first();
        instructorDiscordId = identity?.providerUserId ?? null;
      }

      await ctx.db.patch(action._id, {
        status: "processing",
        lockedAt: now,
        attempts: (action.attempts ?? 0) + 1,
      });

      claimed.push({
        id: action._id.toString(),
        // Cast for legacy codegen enum mismatch (assign_mentee_role vs assign_student_role)
        type: action.type as any,
        status: "processing",
        subjectUserId: action.subjectUserId,
        instructorId: action.instructorId ?? null,
        instructorUserId: action.instructorUserId ?? null,
        instructorDiscordId,
        payload: action.payload,
        attempts: (action.attempts ?? 0) + 1,
        lastError: action.lastError ?? null,
        lockedAt: now,
      });
    }

    return claimed;
  },
});

/**
 * Marks a Discord action as successfully completed.
 * Clears the lock and sets status to done.
 * Internal use only.
 */
export const markDiscordActionDone = internalMutation({
  args: { actionId: v.id("discordActionQueue") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.actionId, {
      status: "done",
      lockedAt: undefined,
    });
    return { success: true };
  },
});

/**
 * Marks a Discord action as failed with an error message.
 * Clears the lock, sets status to failed, and stores the error (truncated to 2000 chars).
 * Internal use only.
 */
export const markDiscordActionFailed = internalMutation({
  args: {
    actionId: v.id("discordActionQueue"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.actionId, {
      status: "failed",
      lockedAt: undefined,
      lastError: args.error.slice(0, 2000),
    });
    return { success: true };
  },
});

/**
 * Requeues a Discord action for retry by resetting status to pending.
 * Optionally stores a new error message.
 * Internal use only.
 */
export const requeueDiscordAction = internalMutation({
  args: {
    actionId: v.id("discordActionQueue"),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.actionId, {
      status: "pending",
      lockedAt: undefined,
      lastError: args.lastError?.slice(0, 2000) ?? undefined,
    });
    return { success: true };
  },
});

/**
 * Applies the result of a batch of Discord action processing in one
 * mutation. This avoids one round-trip per action to Convex.
 * Internal use only.
 */
export const applyDiscordActionResults = internalMutation({
  args: {
    doneIds: v.array(v.id("discordActionQueue")),
    failedIds: v.array(v.id("discordActionQueue")),
    failedErrors: v.array(v.string()),
    requeuedIds: v.array(v.id("discordActionQueue")),
    requeuedErrors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const {
      doneIds,
      failedIds,
      failedErrors,
      requeuedIds,
      requeuedErrors,
    } = args;

    await Promise.all([
      ...doneIds.map((id) =>
        ctx.db.patch(id, {
          status: "done",
          lockedAt: undefined,
        })
      ),
      ...failedIds.map((id, index) =>
        ctx.db.patch(id, {
          status: "failed",
          lockedAt: undefined,
          lastError: failedErrors[index]?.slice(0, 2000) ?? "Unknown error",
          updatedAt: now,
        })
      ),
      ...requeuedIds.map((id, index) =>
        ctx.db.patch(id, {
          status: "pending",
          lockedAt: undefined,
          lastError: requeuedErrors[index]?.slice(0, 2000) ?? undefined,
          updatedAt: now,
        })
      ),
    ]);

    return {
      applied: doneIds.length + failedIds.length + requeuedIds.length,
    };
  },
});

/**
 * Checks whether there are any Discord actions eligible for processing
 * (pending or stale processing). Used by the cron action to short-circuit
 * when the queue is empty, cutting down on empty log noise in the Convex
 * dashboard.
 * Internal use only.
 */
export const hasEligibleDiscordActions = internalQuery({
  args: { lockTtlMs: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lockThreshold = now - args.lockTtlMs;

    const pending = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .first();
    if (pending) return true;

    const staleProcessing = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .filter((q) => q.lt(q.field("lockedAt"), lockThreshold))
      .first();
    return staleProcessing !== null;
  },
});

class DiscordApiError extends Error {
  public readonly status: number;
  constructor(args: { message: string; status: number }) {
    super(args.message);
    this.name = "DiscordApiError";
    this.status = args.status;
  }
}

function getDiscordBotToken(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN;
}

function getDiscordGuildId(): string {
  return process.env.DISCORD_GUILD_ID ?? "";
}

function getStudentRoleName(): string {
  // Prefer new env var, retain legacy fallback to avoid breaking existing deployments
  return process.env.DISCORD_STUDENT_ROLE_NAME ?? process.env.DISCORD_MENTEE_ROLE_NAME ?? "";
}

async function discordRequest<T>(args: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}): Promise<T> {
  const token = getDiscordBotToken();
  if (!token) {
    throw new DiscordApiError({ status: 0, message: "DISCORD_BOT_TOKEN is not configured" });
  }

  const url = `https://discord.com/api/v10${args.path}`;
  const res = await fetch(url, {
    method: args.method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    const message = typeof json === "object" && json && "message" in json
      ? (json as { message: string }).message
      : `Discord API request failed: ${res.status}`;
    throw new DiscordApiError({ status: res.status, message });
  }

  return json as T;
}

async function createDmChannel(discordUserId: string): Promise<{ id: string }> {
  return await discordRequest<{ id: string }>({
    method: "POST",
    path: "/users/@me/channels",
    body: { recipient_id: discordUserId },
  });
}

async function addGuildMemberRole(args: {
  guildId: string;
  discordUserId: string;
  roleId: string;
}): Promise<void> {
  await discordRequest<void>({
    method: "PUT",
    path: `/guilds/${args.guildId}/members/${args.discordUserId}/roles/${args.roleId}`,
  });
}

async function getGuildRoleByName(args: {
  guildId: string;
  roleName: string;
}): Promise<string | null> {
  const roles = await discordRequest<Array<{ id: string; name: string }>>({
    method: "GET",
    path: `/guilds/${args.guildId}/roles`,
  });

  const role = roles.find(r => r.name.toLowerCase() === args.roleName.toLowerCase());
  return role?.id ?? null;
}

async function sendDmMessage(args: {
  discordUserId: string;
  content: string;
}): Promise<string> {
  const channel = await createDmChannel(args.discordUserId);
  const res = await discordRequest<{ id: string }>({
    method: "POST",
    path: `/channels/${channel.id}/messages`,
    body: { content: args.content.slice(0, 2000) },
  });
  return res.id;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_URL;
  }
  if (typeof process !== "undefined" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/**
 * Processes pending Discord actions (assign_student_role, dm_instructor_new_signup).
 * Claims actions, executes them, and updates their status.
 * Handles rate limiting (429) and server errors (>=500) with automatic requeue.
 * Internal action - called by cron job.
 */
export const processDiscordActionQueue = internalAction({
  args: {},
  handler: async (ctx) => {
    type ClaimedAction = {
      id: string;
      type: "assign_student_role" | "dm_instructor_new_signup";
      status: string;
      subjectUserId: string;
      instructorId: string | null;
      instructorUserId: string | null;
      instructorDiscordId: string | null;
      payload: unknown;
      attempts: number;
      lastError: string | null;
      lockedAt: number;
    };
    const lockTtlMs = LOCK_TTL_MS;
    const claimLimit = 25;

    // `claimDiscordActions` already atomically locks and returns the next
    // batch. If nothing is returned, the queue is empty and we can exit
    // immediately without a separate eligibility query.
    const actions: ClaimedAction[] = await ctx.runMutation(
      internal.discordActionQueue.claimDiscordActions,
      {
        limit: claimLimit,
        lockTtlMs,
      }
    );

    if (actions.length === 0) {
      return { success: true, processed: 0, done: 0, failed: 0, requeued: 0, skipped: true };
    }

    const doneIds: Id<"discordActionQueue">[] = [];
    const failedIds: Id<"discordActionQueue">[] = [];
    const failedErrors: string[] = [];
    const requeuedIds: Id<"discordActionQueue">[] = [];
    const requeuedErrors: string[] = [];

    for (const action of actions) {
      try {
        if (action.type === "assign_student_role") {
          const payload = action.payload as {
            discordId: string;
            guildId?: string | null;
            roleName?: string | null;
            roleId?: string | null;
          };

          const guildId = payload.guildId ?? getDiscordGuildId();
          const discordUserId = payload.discordId;

          if (!guildId || !discordUserId) {
            throw new Error("Missing guildId or discordUserId for assign_student_role");
          }

          if (payload.roleId && payload.roleId.trim().length > 0) {
            await addGuildMemberRole({ guildId, discordUserId, roleId: payload.roleId });
          } else {
            const roleName = payload.roleName ?? getStudentRoleName();
            if (!roleName) {
              throw new Error("Missing roleName for assign_student_role");
            }

            const roleId = await getGuildRoleByName({ guildId, roleName });
            if (!roleId) {
              throw new Error(`Role '${roleName}' not found in guild`);
            }

            await addGuildMemberRole({ guildId, discordUserId, roleId });
          }

          doneIds.push(action.id as Id<"discordActionQueue">);
          continue;
        }

        if (action.type === "dm_instructor_new_signup") {
          const payload = action.payload as {
            kind: "purchase";
            orderId: string;
            sessionPackId: string;
            dashboardUrl: string;
            onboardingUrl: string;
          };

          if (!action.instructorUserId) {
            throw new Error("Missing instructorUserId for dm_instructor_new_signup");
          }

          if (!action.instructorDiscordId) {
            throw new Error("Instructor Discord identity not connected");
          }

          const content =
            `New signup:\n\n` +
            `- Order: ${payload.orderId}\n` +
            `- Session pack: ${payload.sessionPackId}\n\n` +
            `Dashboard: ${payload.dashboardUrl}\n` +
            `Onboarding: ${payload.onboardingUrl}`;

          await sendDmMessage({ discordUserId: action.instructorDiscordId, content });

          // DMs are not idempotent: mark the action done immediately so a
          // crash after the send does not replay the DM during the next
          // claim cycle. Role assignments remain batched because they are
          // idempotent.
          await ctx.runMutation(
            internal.discordActionQueue.markDiscordActionDone,
            { actionId: action.id as Id<"discordActionQueue"> }
          );
          continue;
        }

        throw new Error(`Unsupported Discord action type: ${action.type}`);
      } catch (err) {
        if (err instanceof DiscordApiError && (err.status === 429 || err.status >= 500)) {
          requeuedIds.push(action.id as Id<"discordActionQueue">);
          requeuedErrors.push(`${err.name}: ${err.message}`.slice(0, 2000));
        } else {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          failedIds.push(action.id as Id<"discordActionQueue">);
          failedErrors.push(errorMessage);
        }
      }
    }

    // Apply all status updates in one Convex round-trip.
    await ctx.runMutation(
      internal.discordActionQueue.applyDiscordActionResults,
      {
        doneIds,
        failedIds,
        failedErrors,
        requeuedIds,
        requeuedErrors,
      }
    );

    // Self-schedule only when there is likely more work: we claimed up to the
    // batch limit (there may be a backlog) or we requeued transient Discord
    // errors that need a retry. Avoids the extra eligibility query per run.
    if (actions.length >= claimLimit || requeuedIds.length > 0) {
      await ctx.scheduler.runAfter(
        DRAIN_DELAY_MS,
        internal.discordActionQueue.processDiscordActionQueue,
        {}
      );
    }

    return {
      success: true,
      processed: actions.length,
      done: doneIds.length,
      failed: failedIds.length,
      requeued: requeuedIds.length,
    };
  },
});
