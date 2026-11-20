/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function seedInstructorAndOnboarding(
  t: ReturnType<typeof convexTest>,
  args: { createdAt: number; email?: string }
) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      name: "Neil Gray",
      slug: "neil-gray",
      email: "nrcgray@gmail.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 3,
      groupInventory: 0,
      maxActiveStudents: 10,
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

  const marked = await t.mutation(internal.onboardingFollowUps.markSent, {
    dedupeKey: first.studentInvites48h[0].dedupeKey,
    onboardingId,
    kind: "student_invite_48h",
    recipient: "student@example.com",
    resendId: "resend-1",
  });
  expect(marked.inserted).toBe(true);

  const duplicate = await t.mutation(internal.onboardingFollowUps.markSent, {
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

  await t.mutation(internal.onboardingFollowUps.markSent, {
    dedupeKey: first.instructorReviews[0].dedupeKey,
    onboardingId,
    kind: "instructor_review_3d",
    recipient: "nrcgray@gmail.com",
  });

  const second = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(second.instructorReviews).toHaveLength(0);
});
