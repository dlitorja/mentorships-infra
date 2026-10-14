/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

/**
 * Test fixture helpers for the bookings.ts archive-gating
 * work in PR-C (Greptile round-4 #1). Keeps each test focused
 * on the assertion and delegates wiring to small builders
 * that mirror the patterns from `convex/workspaces.archive.test.ts`.
 */

async function seedStudentInstructor(
  t: ReturnType<typeof convexTest>,
  opts: {
    studentUserId: string;
    studentEmail: string;
    instructorUserId: string;
  }
): Promise<{ instructorId: string }> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: opts.studentUserId,
      clerkId: opts.studentUserId,
      email: opts.studentEmail,
      firstName: "Test",
      lastName: "Student",
      role: "student",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: opts.instructorUserId,
      email: "instructor@example.com",
      name: "Test Instructor",
    });
    return { instructorId };
  });
}

async function seedMentorshipWorkspace(
  t: ReturnType<typeof convexTest>,
  opts: {
    ownerId: string;
    instructorId: string;
    archivedAt?: number;
    endedAt?: number;
    deletedAt?: number;
  }
): Promise<Id<"workspaces">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("workspaces", {
      name: "Test Mentorship",
      ownerId: opts.ownerId,
      instructorId: opts.instructorId as never,
      type: "mentorship",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      archivedAt: opts.archivedAt,
      endedAt: opts.endedAt,
      deletedAt: opts.deletedAt,
    });
  });
}

const baseCreatePendingArgs = {
  startUtc: Date.now() + 60 * 60 * 1000,
  endUtc: Date.now() + 2 * 60 * 60 * 1000,
  timezone: "UTC",
  studentEmail: "student@example.test",
  studentName: "Test Student",
  idempotencyKey: "ik_test_1",
};

test("bookings.createPending accepts a student with no workspace pair at all", async () => {
  // Fresh student discovering an instructor — calendar booking
  // is the *first* signal of the relationship, so the archive guard
  // must not fire (no pair exists).
  const STUDENT = "user_student_no_pair";
  const INSTRUCTOR_USER = "user_instructor_1";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-no-pair@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  const result = await studentClient.mutation(api.bookings.createPending, {
    instructorId: instructorId as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_student_no_pair_1",
  });
  expect(result).toEqual({
    conflict: false,
    bookingId: expect.any(String),
  });
});

test("bookings.createPending accepts a student with an active mentorship workspace pair", async () => {
  const STUDENT = "user_student_active";
  const INSTRUCTOR_USER = "user_instructor_2";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-active@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  const result = await studentClient.mutation(api.bookings.createPending, {
    instructorId: instructorId as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_student_active_1",
  });
  expect(result).toEqual({
    conflict: false,
    bookingId: expect.any(String),
  });
});

test("bookings.createPending rejects a student whose ONLY mentorship pair is archived", async () => {
  // PR archive-gating: archive UI explicitly says "this workspace is
  // no longer bookable" so the calendar booking surface must enforce
  // the same promise.
  const STUDENT = "user_student_archived";
  const INSTRUCTOR_USER = "user_instructor_3";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-archived@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    archivedAt: Date.now() - 1000,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  await expect(
    studentClient.mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_student_archived_1",
    })
  ).rejects.toThrow(/archived or ended/);
});

test("bookings.createPending rejects a student whose only pair is ended (endedAt set)", async () => {
  // Companion to the archive rejection — an ended-only pair is also
  // unbookable from the student's calendar.
  const STUDENT = "user_student_ended";
  const INSTRUCTOR_USER = "user_instructor_4";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-ended@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    endedAt: Date.now() - 5000,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  await expect(
    studentClient.mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_student_ended_1",
    })
  ).rejects.toThrow(/archived or ended/);
});

test("bookings.createPending accepts when student has 1 active + 1 archived pair (active pair wins)", async () => {
  // The guard relies on `hasActivePair` — if any non-archived,
  // non-ended pair exists, the student can still book.
  const STUDENT = "user_student_mixed";
  const INSTRUCTOR_USER = "user_instructor_5";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-mixed@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  // Two pairs: one archived, one active.
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    archivedAt: Date.now() - 1000 * 60 * 60,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  const result = await studentClient.mutation(api.bookings.createPending, {
    instructorId: instructorId as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_student_mixed_1",
  });
  expect(result).toEqual({
    conflict: false,
    bookingId: expect.any(String),
  });
});

test("bookings.createPending accepts a caller with an archived pair when they have an instructor profile (instructor role bypass)", async () => {
  // The guard is BYPASSED for non-student callers (admins and
  // instructors), since they may need to book on a student's behalf
  // even when the relationship is archived. We exercise the
  // instructor-bypass path here.
  const INSTRUCTOR_USER = "user_instructor_callable";
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: INSTRUCTOR_USER,
      clerkId: INSTRUCTOR_USER,
      email: "instructor-callable@example.test",
      firstName: "Test",
      lastName: "Instructor",
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_USER,
      email: "instructor-callable@example.test",
      name: "Instructor A",
    });
    const targetInstructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_target",
      email: "instructor-target@example.test",
      name: "Instructor B",
    });
    await ctx.db.insert("workspaces", {
      name: "Archived pair",
      ownerId: INSTRUCTOR_USER,
      instructorId: targetInstructorId,
      type: "mentorship",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      archivedAt: Date.now() - 1000,
    });
  });
  const instructorClient = t.withIdentity({ subject: INSTRUCTOR_USER });
  const result = await instructorClient.mutation(api.bookings.createPending, {
    instructorId: (await t.run(async (ctx) => {
      const row = await ctx.db
        .query("instructors")
        .filter((q) => q.eq(q.field("name"), "Instructor B"))
        .first();
      return row!._id;
    })) as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_instructor_bypass_1",
  });
  expect(result).toEqual({
    conflict: false,
    bookingId: expect.any(String),
  });
});
