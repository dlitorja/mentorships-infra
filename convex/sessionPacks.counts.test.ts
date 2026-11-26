/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ADMIN_ID = "user_admin_pack_counts";
const INSTRUCTOR_ID = "user_instructor_pack_counts";
const STUDENT_ID = "user_student_pack_counts";

/**
 * Seed an admin (`users.role = "admin"`), an instructor and one session
 * pack owned by that instructor.
 */
async function seedPack(
  t: ReturnType<typeof convexTest>,
  counts: { totalSessions: number; remainingSessions: number },
) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN_ID,
      clerkId: ADMIN_ID,
      email: "admin-pack-counts@example.com",
      role: "admin",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_ID,
      email: "instructor-pack-counts@example.com",
      name: "Pack Counts Instructor",
      slug: "pack-counts-instructor",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: STUDENT_ID,
      instructorId,
      totalSessions: counts.totalSessions,
      remainingSessions: counts.remainingSessions,
      purchasedAt: Date.now(),
      status: counts.remainingSessions === 0 ? "depleted" : "active",
    });
    return { instructorId, sessionPackId };
  });
}

// ---------------------------------------------------------------------------
// admin.incrementRemainingSessions
//
// The marketing admin "Sessions +/-" control calls this directly. It used
// to raise `remainingSessions` without touching `totalSessions`, so a full
// pack (4/4) incremented here became 4/5. That state is unrepairable from
// the platform workspace dialog, which caps the input at `totalSessions`
// ("Remaining cannot exceed the original pack size") and whose Reset cannot
// restore it either (the route rejects `remaining > total` with a 400).
// Keeping `remainingSessions <= totalSessions` here matches every other
// grant path (`sessionPacks.addSessionsToPack`, pack creation, onboarding).
// ---------------------------------------------------------------------------

test("incrementRemainingSessions grows the pack when the balance is full", async () => {
  const t = convexTest(schema, modules);
  const { sessionPackId } = await seedPack(t, { totalSessions: 4, remainingSessions: 4 });

  const result = await t
    .withIdentity({ subject: ADMIN_ID })
    .mutation(api.admin.incrementRemainingSessions, { sessionPackId });

  expect(result.remainingSessions).toBe(5);
  expect(result.totalSessions).toBe(5);

  const pack = await t.run(async (ctx) => await ctx.db.get(sessionPackId));
  expect(pack?.remainingSessions).toBe(5);
  expect(pack?.totalSessions).toBe(5);
  expect(pack!.remainingSessions).toBeLessThanOrEqual(pack!.totalSessions);
});

test("incrementRemainingSessions leaves the pack size alone when a credit is already available", async () => {
  const t = convexTest(schema, modules);
  const { sessionPackId } = await seedPack(t, { totalSessions: 4, remainingSessions: 2 });

  const result = await t
    .withIdentity({ subject: ADMIN_ID })
    .mutation(api.admin.incrementRemainingSessions, { sessionPackId });

  expect(result.remainingSessions).toBe(3);
  expect(result.totalSessions).toBe(4);

  const pack = await t.run(async (ctx) => await ctx.db.get(sessionPackId));
  expect(pack?.remainingSessions).toBe(3);
  expect(pack?.totalSessions).toBe(4);
});

test("incrementRemainingSessions revives a depleted pack", async () => {
  const t = convexTest(schema, modules);
  const { sessionPackId } = await seedPack(t, { totalSessions: 4, remainingSessions: 0 });

  const result = await t
    .withIdentity({ subject: ADMIN_ID })
    .mutation(api.admin.incrementRemainingSessions, { sessionPackId });

  expect(result.remainingSessions).toBe(1);
  expect(result.totalSessions).toBe(4);
  expect(result.status).toBe("active");
});

// ---------------------------------------------------------------------------
// sessionPacks.setSessionPackTotals
//
// The platform workspace dialog ("Edit remaining sessions") submits this
// with `expected*` values read from the subscription. Pinning the contract
// shows why an over-capacity pack is a dead end in the UI: the current
// value is above `totalSessions`, so submitting it unchanged is rejected.
// ---------------------------------------------------------------------------

test("setSessionPackTotals accepts a remaining count within the pack size", async () => {
  const t = convexTest(schema, modules);
  const { sessionPackId } = await seedPack(t, { totalSessions: 4, remainingSessions: 5 });

  // Lowering the count is the recovery path a real instructor has today.
  const updated = await t
    .withIdentity({ subject: INSTRUCTOR_ID })
    .mutation(api.sessionPacks.setSessionPackTotals, {
      id: sessionPackId,
      totalSessions: 4,
      remainingSessions: 4,
      expectedTotalSessions: 4,
      expectedRemainingSessions: 5,
    });

  expect(updated?.remainingSessions).toBe(4);
  expect(updated?.totalSessions).toBe(4);
});

test("setSessionPackTotals rejects saving a count above the pack size", async () => {
  const t = convexTest(schema, modules);
  const { sessionPackId } = await seedPack(t, { totalSessions: 4, remainingSessions: 5 });

  await expect(
    t.withIdentity({ subject: INSTRUCTOR_ID }).mutation(api.sessionPacks.setSessionPackTotals, {
      id: sessionPackId,
      totalSessions: 4,
      remainingSessions: 5,
      expectedTotalSessions: 4,
      expectedRemainingSessions: 5,
    }),
  ).rejects.toThrow(/Remaining cannot exceed total/);
});
