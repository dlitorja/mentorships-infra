import { mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const migrateDiscordAction = mutation({
  args: {
    type: v.union(
      v.literal("assign_mentee_role"),
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

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingBySubjectUserId._id, updates);
      }
      return { action: "updated", id: existingBySubjectUserId._id };
    }

    const insertResult = await ctx.db.insert("discordActionQueue", {
      type: args.type,
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
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(args.limit);

    const staleProcessingActions = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .filter((q) => q.lt(q.field("lockedAt"), lockThreshold))
      .take(args.limit);

    const actionsToClaim = [...pendingActions, ...staleProcessingActions];

    const claimed: Array<{
      id: string;
      type: "assign_mentee_role" | "dm_instructor_new_signup";
      status: string;
      subjectUserId: string;
      instructorId: string | null;
      instructorUserId: string | null;
      payload: unknown;
      attempts: number;
      lastError: string | null;
      lockedAt: number;
    }> = [];

    for (const action of actionsToClaim) {
      await ctx.db.patch(action._id, {
        status: "processing",
        lockedAt: now,
        attempts: (action.attempts ?? 0) + 1,
      });

      claimed.push({
        id: action._id.toString(),
        type: action.type,
        status: "processing",
        subjectUserId: action.subjectUserId,
        instructorId: action.instructorId ?? null,
        instructorUserId: action.instructorUserId ?? null,
        payload: action.payload,
        attempts: (action.attempts ?? 0) + 1,
        lastError: action.lastError ?? null,
        lockedAt: now,
      });
    }

    return claimed;
  },
});

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

export const getDiscordIdentityForUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.db
      .query("userIdentities")
      .withIndex("by_userId_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "discord")
      )
      .first();
    return identity?.providerUserId ?? null;
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

function getMenteeRoleName(): string {
  return process.env.DISCORD_MENTEE_ROLE_NAME ?? "";
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

export const processDiscordActionQueue = internalAction({
  args: {},
  handler: async (ctx) => {
    type ClaimedAction = {
      id: string;
      type: "assign_mentee_role" | "dm_instructor_new_signup";
      status: string;
      subjectUserId: string;
      instructorId: string | null;
      instructorUserId: string | null;
      payload: unknown;
      attempts: number;
      lastError: string | null;
      lockedAt: number;
    };
    const actions: ClaimedAction[] = await ctx.runMutation(internal.discordActionQueue.claimDiscordActions, {
      limit: 25,
      lockTtlMs: 10 * 60 * 1000,
    });

    let done = 0;
    let failed = 0;
    let requeued = 0;

    for (const action of actions) {
      try {
        if (action.type === "assign_mentee_role") {
          const payload = action.payload as {
            discordId: string;
            guildId?: string | null;
            roleName?: string | null;
            roleId?: string | null;
          };

          const guildId = payload.guildId ?? getDiscordGuildId();
          const discordUserId = payload.discordId;

          if (!guildId || !discordUserId) {
            throw new Error("Missing guildId or discordUserId for assign_mentee_role");
          }

          if (payload.roleId && payload.roleId.trim().length > 0) {
            await addGuildMemberRole({ guildId, discordUserId, roleId: payload.roleId });
          } else {
            const roleName = payload.roleName ?? getMenteeRoleName();
            if (!roleName) {
              throw new Error("Missing roleName for assign_mentee_role");
            }

            const roleId = await getGuildRoleByName({ guildId, roleName });
            if (!roleId) {
              throw new Error(`Role '${roleName}' not found in guild`);
            }

            await addGuildMemberRole({ guildId, discordUserId, roleId });
          }

          await ctx.runMutation(internal.discordActionQueue.markDiscordActionDone, {
            actionId: action.id as any,
          });
          done += 1;
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

          const instructorDiscordId = await ctx.runQuery(
            internal.discordActionQueue.getDiscordIdentityForUserId,
            { userId: action.instructorUserId }
          );

          if (!instructorDiscordId) {
            throw new Error("Instructor Discord identity not connected");
          }

          const content =
            `New signup:\n\n` +
            `- Order: ${payload.orderId}\n` +
            `- Session pack: ${payload.sessionPackId}\n\n` +
            `Dashboard: ${payload.dashboardUrl}\n` +
            `Onboarding: ${payload.onboardingUrl}`;

          await sendDmMessage({ discordUserId: mentorDiscordId, content });

          await ctx.runMutation(internal.discordActionQueue.markDiscordActionDone, {
            actionId: action.id as any,
          });
          done += 1;
          continue;
        }

        throw new Error(`Unsupported Discord action type: ${action.type}`);
      } catch (err) {
        if (err instanceof DiscordApiError && (err.status === 429 || err.status >= 500)) {
          await ctx.runMutation(internal.discordActionQueue.requeueDiscordAction, {
            actionId: action.id as any,
            lastError: `${err.name}: ${err.message}`.slice(0, 2000),
          });
          requeued += 1;
        } else {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          await ctx.runMutation(internal.discordActionQueue.markDiscordActionFailed, {
            actionId: action.id as any,
            error: errorMessage,
          });
          failed += 1;
        }
      }
    }

    return { success: true, processed: actions.length, done, failed, requeued };
  },
});