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
  ).rejects.toThrow(/(archived|session pack.*ended)/);
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
  ).rejects.toThrow(/(archived|session pack.*ended)/);
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

test("bookings.createPending rejects when caller has NO users row but owns an archived pair (missing-profile guard)", async () => {
  // Greptile round-5 #1: the original gate relied on
  // `users.role === "student"` as the trigger. A user whose Clerk
  // subject IS the ownerId of an archived workspace but who has not
  // yet completed onboarding (no `users` row, or a `users` row with
  // an unset role) would silently bypass the archive guard.
  //
  // The fix changes the heuristic: gate on workspace OWNERSHIP (a
  // positive check) and bypass only when the user is CONFIRMED staff
  // (admin / support / instructor). After the fix, this case rejects.
  const STUDENT_CLERK = "user_student_no_profile";
  const INSTRUCTOR_USER = "user_instructor_no_profile";
  const t = convexTest(schema, modules);
  const { instructorId } = await t.run(async (ctx) => {
    // Seed the instructor row only — no `users` row for the student.
    const instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_USER,
      email: "instructor-noProfile@example.test",
      name: "Test Instructor",
    });
    return { instructorId };
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaces", {
      name: "Archived pair (— student has no profile)",
      ownerId: STUDENT_CLERK, // mock identity subject is the owner
      instructorId: instructorId as never,
      type: "mentorship",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      archivedAt: Date.now() - 1000,
    });
  });
  const studentClient = t.withIdentity({ subject: STUDENT_CLERK });
  await expect(
    studentClient.mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_no_profile_archived_1",
    })
  ).rejects.toThrow(/(archived|session pack.*ended)/);
});

test("bookings.createPending rejects when caller has a users row with UNSET role but owns an archived pair", async () => {
  // Greptile round-5 #1 companion: a student with a `users` row but
  // an unset role field (e.g. legacy / migration in-progress) should
  // still get the archive guard. The role field is OPTIONAL, so the
  // absence of `role` must not be treated as "not a student".
  const STUDENT_CLERK = "user_student_unset_role";
  const INSTRUCTOR_USER = "user_instructor_unset_role";
  const t = convexTest(schema, modules);
  const { instructorId } = await t.run(async (ctx) => {
    // The role field on `users` is optional per the schema. Insert a
    // row whose role is explicitly absent so the cast-heuristic of the
    // original gating code (`role === "student"` => check the archive)
    // would have silently bypassed the guard.
    await ctx.db.insert("users", {
      userId: STUDENT_CLERK,
      clerkId: STUDENT_CLERK,
      email: "unset-role@example.test",
      firstName: "Test",
      lastName: "Student",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_USER,
      email: "instructor-unsetRole@example.test",
      name: "Test Instructor",
    });
    return { instructorId };
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaces", {
      name: "Archived pair (— student has unset role)",
      ownerId: STUDENT_CLERK,
      instructorId: instructorId as never,
      type: "mentorship",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      archivedAt: Date.now() - 1000,
    });
  });
  const studentClient = t.withIdentity({ subject: STUDENT_CLERK });
  await expect(
    studentClient.mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_unset_role_archived_1",
    })
  ).rejects.toThrow(/(archived|session pack.*ended)/);
});

test("bookings.createPending accepts an admin caller with an archived pair (admin bypass)", async () => {
  // The admin bypass uses positive role identification — confirm
  // an "admin" user can still book against an archived relationship.
  const ADMIN_CLERK = "user_admin_archived";
  const INSTRUCTOR_USER = "user_instructor_admin";
  const t = convexTest(schema, modules);
  const { instructorId } = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN_CLERK,
      clerkId: ADMIN_CLERK,
      email: "admin-bypass@example.test",
      firstName: "Test",
      lastName: "Admin",
      role: "admin",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_USER,
      email: "instructor-admin@example.test",
      name: "Target Instructor",
    });
    return { instructorId };
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaces", {
      name: "Archived pair (— admin scheduling follow-up)",
      ownerId: ADMIN_CLERK,
      instructorId: instructorId as never,
      type: "mentorship",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      archivedAt: Date.now() - 1000,
    });
  });
  const adminClient = t.withIdentity({ subject: ADMIN_CLERK });
  const result = await adminClient.mutation(api.bookings.createPending, {
    instructorId: instructorId as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_admin_bypass_1",
  });
  expect(result).toEqual({
    conflict: false,
    bookingId: expect.any(String),
  });
});

test("bookings.createPending idempotent RETRY after caller archives their only workspace (round-6 P2)", async () => {
  // Greptile round-6 P2: a student who created a pending booking
  // then archives their only workspace pair with the instructor
  // and retries the same POST with the same `idempotencyKey` must
  // receive the canonical `conflict: true, bookingId: <existing>`
  // response \u2014 NOT a generic 500 from the archive guard.
  //
  // After the reorder, the idempotency lookup runs FIRST and short-
  // circuits before the archive guard. The booking still exists and
  // the retry resolves it cleanly.
  const STUDENT = "user_student_archive_after_book";
  const INSTRUCTOR_USER = "user_instructor_archive_after_book";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-archive-after@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  const wsId = await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  // 1. First createPending succeeds (active pair).
  const first = await studentClient.mutation(api.bookings.createPending, {
    instructorId: instructorId as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_round6_retry_1",
  });
  expect(first).toEqual({ conflict: false, bookingId: expect.any(String) });

  // 2. Caller archives the workspace.
  await t.run(async (ctx) => {
    await ctx.db.patch(wsId, { archivedAt: Date.now() });
  });

  // 3. Same POST retried with same idempotencyKey returns the
  //    EXISTING booking as conflict \u2014 the archive guard does NOT fire
  //    because the idempotency lookup short-circuits first.
  const retry = await studentClient.mutation(api.bookings.createPending, {
    instructorId: instructorId as never,
    ...baseCreatePendingArgs,
    idempotencyKey: "ik_round6_retry_1",
  });
  expect(retry).toEqual({
    conflict: true,
    bookingId: first.bookingId,
  });
});

test("bookings.createPending FRESH (no previous) booking after caller archives their only workspace still rejects", async () => {
  // Companion to the round-6 P2 test \u2014 if the caller truly has no
  // previous booking (no idempotency match), and they have just
  // archived their only pair, the archive guard fires on the new
  // booking attempt. Idempotency alone does NOT bypass the archive
  // guard for genuinely fresh creation.
  const STUDENT = "user_student_fresh_after_archive";
  const INSTRUCTOR_USER = "user_instructor_fresh_after_archive";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-fresh-after@example.test",
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
      idempotencyKey: "ik_fresh_after_archive_1",
    })
  ).rejects.toThrow(/(archived|session pack.*ended)/);
});

test("bookings.createPending throws a typed ConvexError with WORKSPACE_ARCHIVED_FOR_BOOKING (round-7 P2)", async () => {
  // Greptile round-7 P2: the previous throw was a plain Error, so
  // the HTTP booking routes caught it as a generic 500. After the
  // fix the throw is a typed `ConvexError({ code, message })` so
  // the routes can detect and return a 409 with the friendly copy.
  const STUDENT = "user_student_archived_r7";
  const INSTRUCTOR_USER = "user_instructor_archived_r7";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "student-r7@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    archivedAt: Date.now() - 1000,
  });
  const studentClient = t.withIdentity({ subject: STUDENT });
  try {
    await studentClient.mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_r7_typed_error_1",
    });
    throw new Error("createPending should have thrown");
  } catch (e) {
    // ConvexError surfaces as an Error subclass with `.data = { code, message }`.
    const convexErr = e as Error & { data?: { code?: string; message?: string } };
    expect(convexErr).toBeInstanceOf(Error);
    expect(convexErr.data?.code).toBe("WORKSPACE_ARCHIVED_FOR_BOOKING");
    // Greptile round-8: verify the typed message exactly matches the
    // archived-only copy. The other failure shapes surface different
    // codes + messages -- see the dedicated tests below.
    expect(convexErr.data?.message).toContain("archived");
    expect(convexErr.data?.message).toMatch(/Unarchive the workspace, then re-submit/);
  }
});
test("bookings.createPending: archived-only pair surfaces WORKSPACE_ARCHIVED_FOR_BOOKING (round-8)", async () => {
  const STUDENT = "user_student_r8_archived";
  const INSTRUCTOR_USER = "user_instructor_r8_archived";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "r8-archived@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    archivedAt: Date.now() - 1000,
  });
  try {
    await t.withIdentity({ subject: STUDENT }).mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_r8_archived_only",
    });
    throw new Error("createPending should have thrown");
  } catch (e) {
    const convexErr = e as Error & { data?: { code?: string; message?: string } };
    expect(convexErr.data?.code).toBe("WORKSPACE_ARCHIVED_FOR_BOOKING");
    expect(convexErr.data?.message).toContain("archived");
    expect(convexErr.data?.message).toMatch(/Unarchive the workspace, then re-submit/);
  }
});


test("bookings.createPending: ended-only pair surfaces WORKSPACE_ENDED_FOR_BOOKING (round-8)", async () => {
  const STUDENT = "user_student_r8_ended";
  const INSTRUCTOR_USER = "user_instructor_r8_ended";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "r8-ended@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    endedAt: Date.now() - 5000,
  });
  try {
    await t.withIdentity({ subject: STUDENT }).mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_r8_ended_only",
    });
    throw new Error("createPending should have thrown");
  } catch (e) {
    const convexErr = e as Error & { data?: { code?: string; message?: string } };
    expect(convexErr.data?.code).toBe("WORKSPACE_ENDED_FOR_BOOKING");
    expect(convexErr.data?.message).toMatch(/session pack.*ended/);
    expect(convexErr.data?.message).toMatch(/Buy a new session pack/);
  }
});


test("bookings.createPending: archived AND ended pair surfaces WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING (round-8)", async () => {
  const STUDENT = "user_student_r8_both";
  const INSTRUCTOR_USER = "user_instructor_r8_both";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "r8-both@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    archivedAt: Date.now() - 2000,
    endedAt: Date.now() - 1000,
  });
  try {
    await t.withIdentity({ subject: STUDENT }).mutation(api.bookings.createPending, {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_r8_both",
    });
    throw new Error("createPending should have thrown");
  } catch (e) {
    const convexErr = e as Error & { data?: { code?: string; message?: string } };
    expect(convexErr.data?.code).toBe("WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING");
    expect(convexErr.data?.message).toMatch(/archived AND/);
    expect(convexErr.data?.message).toMatch(/Buy a new session pack/);
  }
});


test("bookings.createPending: 1 active + 1 archived pair still allows the booking (regression cover)", async () => {
  // Round-8 regression: when the caller has a MIX of pairs (one
  // active, one archived), the rejection does not fire at all
  // because `hasActivePair` is true. Behaviour unchanged.
  const STUDENT = "user_student_r8_mixed";
  const INSTRUCTOR_USER = "user_instructor_r8_mixed";
  const t = convexTest(schema, modules);
  const { instructorId } = await seedStudentInstructor(t, {
    studentUserId: STUDENT,
    studentEmail: "r8-mixed@example.test",
    instructorUserId: INSTRUCTOR_USER,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
    archivedAt: Date.now() - 1000 * 60 * 60,
  });
  await seedMentorshipWorkspace(t, {
    ownerId: STUDENT,
    instructorId,
  });
  const result = await t.withIdentity({ subject: STUDENT }).mutation(
    api.bookings.createPending,
    {
      instructorId: instructorId as never,
      ...baseCreatePendingArgs,
      idempotencyKey: "ik_r8_mixed_active",
    }
  );
  expect(result).toEqual({ conflict: false, bookingId: expect.any(String) });
});




