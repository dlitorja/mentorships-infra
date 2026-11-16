/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Canonical `activeStudentCount` (audit §1.4): distinct students holding at
 * least one active seat.
 *
 * Counting seats or packs overstates the number whenever a student buys a
 * second pack, and the number feeds the dashboard badge, the expanded
 * instructor row, the instructors list, and onboarding capacity gating —
 * where an inflated count can block a legitimate onboarding.
 */
async function seedInstructorWithTwoPacksForOneStudent() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin",
      clerkId: "user_admin",
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: "user_student",
      clerkId: "user_student",
      email: "student@example.com",
      role: "student",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor",
      email: "instructor@example.com",
      name: "Ada Instructor",
      slug: "ada",
      maxActiveStudents: 2,
      oneOnOneInventory: 3,
      groupInventory: 2,
    });

    const seatExpiresAt = Date.UTC(2026, 11, 31);
    const packIds: string[] = [];
    for (const [totalSessions, remainingSessions] of [
      [4, 2],
      [2, 2],
    ] as const) {
      const sessionPackId = await ctx.db.insert("sessionPacks", {
        userId: "user_student",
        instructorId,
        totalSessions,
        remainingSessions,
        purchasedAt: Date.UTC(2025, 11, 1),
        status: "active",
      });
      packIds.push(sessionPackId);
      await ctx.db.insert("seatReservations", {
        instructorId,
        userId: "user_student",
        sessionPackId,
        seatExpiresAt,
        status: "active",
      });
    }

    return { instructorId, packIds };
  });

  return { t, ...ids };
}

test("getInstructorWithStudents: one student with two active packs counts once", async () => {
  const { t, instructorId } = await seedInstructorWithTwoPacksForOneStudent();

  const result = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.admin.getInstructorWithStudents, { instructorId });

  expect(result).not.toBeNull();
  // Two enrollments, one person.
  expect(result!.students).toHaveLength(2);
  expect(result!.activeStudentCount).toBe(1);
});

test("getInstructorsWithStatsForAdmin: counts the student once, not once per pack", async () => {
  const { t } = await seedInstructorWithTwoPacksForOneStudent();

  const result = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.admin.getInstructorsWithStatsForAdmin, {
      paginationOpts: { numItems: 10, cursor: null },
    });

  expect(result.page).toHaveLength(1);
  expect(result.page[0].activeStudentCount).toBe(1);
});

test("getInstructorsForAdmin: dashboard list counts the student once", async () => {
  const { t } = await seedInstructorWithTwoPacksForOneStudent();

  const result = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.instructors.getInstructorsForAdmin, {});

  expect(result).toHaveLength(1);
  expect(result[0].activeStudentCount).toBe(1);
});

test("onboarding capacity: a second pack does not put the instructor at capacity", async () => {
  // maxActiveStudents is 2; the one student holds two seats. Counting seats
  // would report 2/2 (at capacity) and force a capacity override. Counting
  // students reports 1/2.
  const { t } = await seedInstructorWithTwoPacksForOneStudent();

  const options = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.adminOnboarding.getInstructorOptionsForOnboarding, {});

  expect(options).toHaveLength(1);
  expect(options[0].activeStudentCount).toBe(1);
  expect(options[0].maxActiveStudents).toBe(2);
});

test("admin.getStats: the dashboard total counts the student once", async () => {
  const { t } = await seedInstructorWithTwoPacksForOneStudent();

  const stats = await t
    .withIdentity({ subject: "user_admin" })
    .query(api.admin.getStats, {});

  expect(stats.totalActiveStudents).toBe(1);
  expect(stats.hasStudentData).toBe(true);
  // No payments were seeded, so revenue is honestly empty rather than invented.
  expect(stats.hasRevenueData).toBe(false);
  expect(stats.revenueThisMonth).toBe(0);
});
