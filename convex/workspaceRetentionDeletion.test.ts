/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { WORKSPACE_RETENTION_MS } from "./workspaceConstants";

const modules = import.meta.glob("./**/*.ts");

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedWorkspace(
  t: ReturnType<typeof convexTest>,
  opts: { endedAt?: number; name: string }
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("workspaces", {
      name: opts.name,
      ownerId: "user_student_retention",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      ...(opts.endedAt !== undefined ? { endedAt: opts.endedAt } : {}),
    });
  });
}

/**
 * Regression test for the 2026-11-14..19 incident: Convex indexes a
 * missing optional field as `null`, which sorts before every number,
 * so `q.lt("endedAt", cutoff)` matched every active workspace. The
 * nightly retention task then hard-deleted their notes, links,
 * images, and chat messages.
 */
test("getWorkspacesNeedingDeletion only returns workspaces past retention", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const activeId = await seedWorkspace(t, { name: "Active" });
  const recentlyEndedId = await seedWorkspace(t, {
    name: "Recently ended",
    endedAt: now - 2 * 30 * DAY_MS,
  });
  const expiredId = await seedWorkspace(t, {
    name: "Expired",
    endedAt: now - WORKSPACE_RETENTION_MS - 2 * DAY_MS,
  });

  const result = await t.query(api.queries.http.getWorkspacesNeedingDeletion);
  const ids = result.map((w) => w.id);

  expect(ids).toContain(expiredId);
  expect(ids).not.toContain(activeId);
  expect(ids).not.toContain(recentlyEndedId);
});

test("getWorkspacesNeedingRetentionDeletion has the same bound", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const activeId = await seedWorkspace(t, { name: "Active legacy" });
  const expiredId = await seedWorkspace(t, {
    name: "Expired legacy",
    endedAt: now - WORKSPACE_RETENTION_MS - 2 * DAY_MS,
  });

  const result = await t.query(
    api.workspaces.getWorkspacesNeedingRetentionDeletion
  );
  const ids = result.map((w) => w._id);

  expect(ids).toContain(expiredId);
  expect(ids).not.toContain(activeId);
});

test("deleteAllWorkspaceContent refuses an active workspace", async () => {
  const t = convexTest(schema, modules);
  const activeId = await seedWorkspace(t, { name: "Protected active" });

  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMessages", {
      workspaceId: activeId,
      userId: "user_student_retention",
      content: "This must survive",
      type: "text",
      senderRole: "student",
    });
  });

  await expect(
    t.mutation(internal.mutations.http.deleteAllWorkspaceContent, {
      workspaceId: activeId,
    })
  ).rejects.toThrow(/active workspace/i);

  const remaining = await t.run(async (ctx) => {
    return await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", activeId))
      .collect();
  });
  expect(remaining).toHaveLength(1);
});

test("deleteAllWorkspaceContent refuses a workspace still inside retention", async () => {
  const t = convexTest(schema, modules);
  const recentId = await seedWorkspace(t, {
    name: "Still inside retention",
    endedAt: Date.now() - 2 * 30 * DAY_MS,
  });

  await expect(
    t.mutation(internal.mutations.http.deleteAllWorkspaceContent, {
      workspaceId: recentId,
    })
  ).rejects.toThrow(/retention window/i);
});

test("deleteAllWorkspaceContent still deletes content past retention", async () => {
  const t = convexTest(schema, modules);
  const expiredId = await seedWorkspace(t, {
    name: "Expired for deletion",
    endedAt: Date.now() - WORKSPACE_RETENTION_MS - 2 * DAY_MS,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMessages", {
      workspaceId: expiredId,
      userId: "user_student_retention",
      content: "Expired content",
      type: "text",
      senderRole: "student",
    });
  });

  const deleted = await t.mutation(
    internal.mutations.http.deleteAllWorkspaceContent,
    { workspaceId: expiredId }
  );
  expect(deleted.deleted.messages).toBe(1);
});
