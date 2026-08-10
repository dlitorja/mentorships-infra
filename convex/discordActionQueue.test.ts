/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("processDiscordActionQueue short-circuits when empty", async () => {
  const t = convexTest(schema, modules);
  const result = await t.action(internal.discordActionQueue.processDiscordActionQueue, {});
  expect(result).toMatchObject({ success: true, processed: 0, skipped: true });
});

test("claimDiscordActions returns oldest pending first", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.discordActionQueue.migrateDiscordAction, {
    type: "assign_student_role",
    subjectUserId: "newer",
    status: "pending",
    createdAt: 2000,
    payload: { discordId: "d", guildId: "g", roleId: "r" },
  });
  await t.mutation(api.discordActionQueue.migrateDiscordAction, {
    type: "assign_student_role",
    subjectUserId: "older",
    status: "pending",
    createdAt: 1000,
    payload: { discordId: "d", guildId: "g", roleId: "r" },
  });

  const claimed = await t.mutation(internal.discordActionQueue.claimDiscordActions, {
    limit: 1,
    lockTtlMs: 10 * 60 * 1000,
  });

  expect(claimed).toHaveLength(1);
  expect(claimed[0].subjectUserId).toBe("older");
});

test("migrateDiscordAction schedules a processor run when the queue was idle", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);

  await t.mutation(api.discordActionQueue.migrateDiscordAction, {
    type: "assign_student_role",
    subjectUserId: "user_1",
    status: "pending",
    payload: { discordId: "d", guildId: "g", roleId: "r" },
  });

  const scheduled = await t.run(async (ctx) => {
    return await ctx.db.system.query("_scheduled_functions").collect();
  });
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].name).toMatch(/processDiscordActionQueue/);
});

test("migrateDiscordAction does not schedule a duplicate when the queue is already eligible", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);

  await t.mutation(api.discordActionQueue.migrateDiscordAction, {
    type: "assign_student_role",
    subjectUserId: "first",
    status: "pending",
    payload: { discordId: "d", guildId: "g", roleId: "r" },
  });

  await t.mutation(api.discordActionQueue.migrateDiscordAction, {
    type: "assign_student_role",
    subjectUserId: "second",
    status: "pending",
    payload: { discordId: "d", guildId: "g", roleId: "r" },
  });

  const scheduled = await t.run(async (ctx) => {
    return await ctx.db.system.query("_scheduled_functions").collect();
  });
  expect(scheduled).toHaveLength(1);
});

test("processDiscordActionQueue self-schedules to drain a backlog", async () => {
  vi.useFakeTimers();
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = "test-token";
  const t = convexTest(schema, modules);
  let fetchCount = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return { ok: false, status: 429, text: async () => "rate limited" } as Response;
      }
      return { ok: false, status: 400, text: async () => "Bad Request" } as Response;
    })
  );

  await t.mutation(api.discordActionQueue.migrateDiscordAction, {
    type: "assign_student_role",
    subjectUserId: "backlog",
    status: "pending",
    payload: { discordId: "d", guildId: "g", roleId: "r" },
  });

  try {
    vi.advanceTimersByTime(5000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const actions = await t.run(async (ctx) => {
      return await ctx.db.query("discordActionQueue").collect();
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].status).toBe("failed");
    expect(fetchCount).toBe(2);
  } finally {
    if (originalToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalToken;
    }
  }
});
