/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedWorkspaces(t: ReturnType<typeof convexTest>) {
  let ids: { mentorshipId: Id<"workspaces">; adminId: Id<"workspaces"> } | null = null;

  await t.run(async (ctx) => {
    const mentorshipId = await ctx.db.insert("workspaces", {
      name: "Mentorship Workspace",
      ownerId: "user_student",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const adminId = await ctx.db.insert("workspaces", {
      name: "Admin Communication",
      ownerId: "user_student",
      isPublic: false,
      type: "admin_student",
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    ids = { mentorshipId, adminId };
  });

  if (!ids) throw new Error("seed failed");
  return ids;
}

test("posts one kickoff message per thread and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const { mentorshipId, adminId } = await seedWorkspaces(t);

  const args = {
    mentorshipWorkspaceId: mentorshipId,
    adminWorkspaceId: adminId,
    instructorName: "Ivy Instructor",
    sessions: 6,
  };

  const first = await t.mutation(internal.workspaces.postOnboardingKickoff, args);
  const second = await t.mutation(internal.workspaces.postOnboardingKickoff, args);

  expect(first.posted).toBe(2);
  expect(second.posted).toBe(0);

  const messages = await t.run(async (ctx) =>
    ctx.db.query("workspaceMessages").collect()
  );

  expect(messages).toHaveLength(2);
  const mentorshipMessage = messages.find((m) => m.workspaceId === mentorshipId);
  const adminMessage = messages.find((m) => m.workspaceId === adminId);

  expect(mentorshipMessage?.type).toBe("system");
  expect(mentorshipMessage?.systemEventKind).toBe("onboarding_kickoff");
  expect(mentorshipMessage?.content).toContain("Ivy Instructor");
  expect(mentorshipMessage?.content).toContain("6 sessions");

  expect(adminMessage?.content).toContain("administrative");
});

test("skips a deleted mentorship workspace", async () => {
  const t = convexTest(schema, modules);
  const { mentorshipId } = await seedWorkspaces(t);

  await t.run(async (ctx) => {
    await ctx.db.patch(mentorshipId, { deletedAt: Date.now() });
  });

  const result = await t.mutation(internal.workspaces.postOnboardingKickoff, {
    mentorshipWorkspaceId: mentorshipId,
    instructorName: "Ivy Instructor",
    sessions: 4,
  });

  expect(result.posted).toBe(0);
});
