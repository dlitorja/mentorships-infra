/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Seed = {
  instructorId: Id<"instructors">;
  sessionPackId: Id<"sessionPacks">;
  seatReservationId: Id<"seatReservations">;
  workspaceId: Id<"workspaces">;
};

/**
 * Seeds the artefacts a completed native purchase already has when the
 * onboarding flow runs: instructor, pack, seat, and workspace.
 */
async function seedPurchase(
  t: ReturnType<typeof convexTest>,
  userId: string
): Promise<Seed> {
  let seed: Seed | null = null;

  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      name: "Parity Instructor",
      slug: "parity-instructor",
      email: "parity@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 5,
      groupInventory: 0,
      maxActiveStudents: 10,
    });

    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId,
      instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
    });

    const seatReservationId = await ctx.db.insert("seatReservations", {
      instructorId,
      userId,
      sessionPackId,
      seatExpiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      status: "active",
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Mentorship Workspace",
      ownerId: userId,
      instructorId,
      isPublic: false,
      seatReservationId,
      studentImageCount: 0,
      instructorImageCount: 0,
    });

    seed = { instructorId, sessionPackId, seatReservationId, workspaceId };
  });

  if (!seed) throw new Error("seed failed");
  return seed;
}

test("creates a completed checkout onboarding row linked to the pack", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedPurchase(t, "user_student_1");

  const result = await t.mutation(internal.adminOnboarding.startCheckoutOnboarding, {
    email: "Student@Example.com",
    userId: "user_student_1",
    instructorId: seed.instructorId,
    sessionPackId: seed.sessionPackId,
    totalSessions: 4,
  });

  expect(result.created).toBe(true);

  const row = await t.run(async (ctx) => ctx.db.get(result.onboardingId));
  expect(row).not.toBeNull();
  expect(row?.source).toBe("checkout");
  expect(row?.status).toBe("completed");
  expect(row?.email).toBe("student@example.com");
  expect(row?.assignedStudentClerkId).toBe("user_student_1");
  expect(row?.perInstructor[0]?.sessionPackId).toBe(seed.sessionPackId);
  expect(row?.perInstructor[0]?.seatReservationId).toBe(seed.seatReservationId);
  expect(row?.perInstructor[0]?.workspaceId).toBe(seed.workspaceId);
  expect(row?.perInstructor[0]?.isRenewal).toBe(false);
});

test("is idempotent on the session pack", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedPurchase(t, "user_student_2");

  const args = {
    email: "student2@example.com",
    userId: "user_student_2",
    instructorId: seed.instructorId,
    sessionPackId: seed.sessionPackId,
    totalSessions: 4,
  };

  const first = await t.mutation(internal.adminOnboarding.startCheckoutOnboarding, args);
  const second = await t.mutation(internal.adminOnboarding.startCheckoutOnboarding, args);

  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(second.onboardingId).toBe(first.onboardingId);
});

test("does not assign a Clerk id to an email-placeholder guest", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedPurchase(t, "email:guest@example.com");

  const result = await t.mutation(internal.adminOnboarding.startCheckoutOnboarding, {
    email: "guest@example.com",
    userId: "email:guest@example.com",
    instructorId: seed.instructorId,
    sessionPackId: seed.sessionPackId,
    totalSessions: 4,
  });

  const row = await t.run(async (ctx) => ctx.db.get(result.onboardingId));
  expect(row?.assignedStudentClerkId).toBeUndefined();
  expect(row?.email).toBe("guest@example.com");
});

test("marks a second pack for the same pair as a renewal", async () => {
  const t = convexTest(schema, modules);
  const seed = await seedPurchase(t, "user_student_3");

  let secondPackId: Id<"sessionPacks"> | null = null;
  await t.run(async (ctx) => {
    secondPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student_3",
      instructorId: seed.instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
    });
  });

  const result = await t.mutation(internal.adminOnboarding.startCheckoutOnboarding, {
    email: "student3@example.com",
    userId: "user_student_3",
    instructorId: seed.instructorId,
    sessionPackId: secondPackId!,
    totalSessions: 4,
  });

  const row = await t.run(async (ctx) => ctx.db.get(result.onboardingId));
  expect(row?.perInstructor[0]?.isRenewal).toBe(true);
});
