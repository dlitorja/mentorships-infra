/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INSTRUCTOR_CLERK_ID = "user_instructor_neil";

async function seedInstructorAndOnboarding(
  t: ReturnType<typeof convexTest>,
  args: { createdAt: number; email?: string }
) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_CLERK_ID,
      name: "Neil Gray",
      slug: "neil-gray",
      email: "nrcgray@gmail.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 3,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    // The review nudge only targets instructors whose Clerk account can open
    // the review link, so the fixture links one.
    await ctx.db.insert("users", {
      userId: INSTRUCTOR_CLERK_ID,
      clerkId: INSTRUCTOR_CLERK_ID,
      email: "nrcgray@gmail.com",
      role: "instructor",
    });
    const onboardingId = await ctx.db.insert("adminOnboardings", {
      email: args.email ?? "student@example.com",
      flowVersion: 1,
      source: "kajabi",
      submittedByUserId: "user_admin",
      status: "completed",
      attemptCount: 1,
      perInstructor: [
        {
          instructorId,
          isRenewal: false,
          sessionsPerInstructor: 4,
        },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [{ at: args.createdAt, event: "queued" }],
      createdAt: args.createdAt,
    });
    return { instructorId, onboardingId };
  });
}

test("scan returns a 48h invite reminder and markSent dedupes it", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { onboardingId } = await seedInstructorAndOnboarding(t, {
    createdAt: now - 49 * HOUR,
  });

  const first = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(first.studentInvites48h).toHaveLength(1);
  expect(first.studentInvites48h[0]).toMatchObject({
    onboardingId,
    studentEmail: "student@example.com",
    instructorName: "Neil Gray",
  });

  const marked = await t.mutation(internal.onboardingReminderReview.markSent, {
    dedupeKey: first.studentInvites48h[0].dedupeKey,
    onboardingId,
    kind: "student_invite_48h",
    recipient: "student@example.com",
    resendId: "resend-1",
  });
  expect(marked.inserted).toBe(true);

  const duplicate = await t.mutation(internal.onboardingReminderReview.markSent, {
    dedupeKey: first.studentInvites48h[0].dedupeKey,
    onboardingId,
    kind: "student_invite_48h",
    recipient: "student@example.com",
    resendId: "resend-1",
  });
  expect(duplicate.inserted).toBe(false);

  const second = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(second.studentInvites48h).toHaveLength(0);
});

test("scan returns a 3-day instructor review nudge and dedupes per instructor", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { instructorId, onboardingId } = await seedInstructorAndOnboarding(t, {
    createdAt: now,
  });

  const submissionId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId,
      studentClerkId: "user_student",
      questionnaireVersion: 1,
      status: "submitted",
      answers: [],
      inspirations: [],
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY,
      submittedAt: now - 4 * DAY,
      reviews: [],
    })
  );

  const first = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(first.instructorReviews).toHaveLength(1);
  expect(first.instructorReviews[0]).toMatchObject({
    onboardingId,
    submissionId,
    instructorId,
    instructorEmail: "nrcgray@gmail.com",
  });

  await t.mutation(internal.onboardingReminderReview.markSent, {
    dedupeKey: first.instructorReviews[0].dedupeKey,
    onboardingId,
    kind: "instructor_review_3d",
    recipient: "nrcgray@gmail.com",
  });

  const second = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(second.instructorReviews).toHaveLength(0);
});

test("one used pair does dot silence another instructor's review nudge", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();

  await t.run(async (ctx) => {
    const makeInstructor = async (slug: string, email: string, clerkId: string) => {
      const id = await ctx.db.insert("instructors", {
        userId: clerkId,
        name: slug,
        slug,
        email,
        isActive: true,
        isNew: false,
        oneOnOneInventory: 3,
        groupInventory: 0,
        maxActiveStudents: 10,
      });
      await ctx.db.insert("users", {
        userId: clerkId,
        clerkId,
        email,
        role: "instructor",
      });
      return id;
    };

    const a = await makeInstructor("coach-a", "a@example.com", "user_coach_a");
    const b = await makeInstructor("coach-b", "b@example.com", "user_coach_b");

    const usedPack = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId: a,
      totalSessions: 4,
      remainingSessions: 2,
      purchasedAt: now,
      status: "active",
    });
    const freshPack = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId: b,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: now,
      status: "active",
    });

    const onboardingId = await ctx.db.insert("adminOnboardings", {
      email: "student@example.com",
      flowVersion: 1,
      source: "kajabi",
      submittedByUserId: "user_admin",
      status: "processing",
      attemptCount: 1,
      assignedStudentClerkId: "user_student",
      perInstructor: [
        { instructorId: a, isRenewal: false, sessionsPerInstructor: 4, sessionPackId: usedPack },
        { instructorId: b, isRenewal: false, sessionsPerInstructor: 4, sessionPackId: freshPack },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [{ at: now, event: "queued" }],
      createdAt: now,
    });

    await ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId,
      studentClerkId: "user_student",
      questionnaireVersion: 1,
      status: "submitted",
      answers: [],
      inspirations: [],
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY,
      submittedAt: now - 4 * DAY,
      reviews: [],
    });
  });

  const scan = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(scan.instructorReviews).toHaveLength(1);
  expect(scan.instructorReviews[0].instructorEmail).toBe("b@example.com");
});
