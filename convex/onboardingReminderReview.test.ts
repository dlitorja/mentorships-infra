/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INSTRUCTOR_CLERK_ID = "user_review_instructor";

async function seed(
  t: ReturnType<typeof convexTest>,
  overrides: {
    createdAt?: number;
    instructorUserId?: string | null;
    packUsed?: boolean;
  } = {}
) {
  const now = Date.now();
  const createdAt = overrides.createdAt ?? now;
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_staff",
      clerkId: "user_staff",
      email: "admin@example.com",
      role: "admin",
    });

    const instructorId = await ctx.db.insert("instructors", {
      ...(overrides.instructorUserId === null
        ? {}
        : { userId: overrides.instructorUserId ?? INSTRUCTOR_CLERK_ID }),
      name: "Neil Gray",
      slug: "neil-gray",
      email: "nrcgray@gmail.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 3,
      groupInventory: 0,
      maxActiveStudents: 10,
    });

    if (overrides.instructorUserId !== null) {
      await ctx.db.insert("users", {
        userId: overrides.instructorUserId ?? INSTRUCTOR_CLERK_ID,
        clerkId: overrides.instructorUserId ?? INSTRUCTOR_CLERK_ID,
        email: "nrcgray@gmail.com",
        role: "instructor",
      });
    }

    const packId = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId,
      totalSessions: 4,
      remainingSessions: overrides.packUsed ? 3 : 4,
      purchasedAt: createdAt,
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
        {
          instructorId,
          isRenewal: false,
          sessionsPerInstructor: 4,
          sessionPackId: packId,
        },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [{ at: createdAt, event: "queued" }],
      createdAt,
    });

    const submissionId = await ctx.db.insert(
      "onboardingQuestionnaireSubmissions",
      {
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
      }
    );

    return { instructorId, onboardingId, submissionId, packId };
  });
}

function reviewItem(onboardingId: string, instructorId: string) {
  return {
    dedupeKey: `onboarding:${onboardingId}:instructor_review_3d:${instructorId}`,
    onboardingId: onboardingId as never,
    kind: "instructor_review_3d" as const,
    recipient: "nrcgray@gmail.com",
    recipientName: "Neil Gray",
    recipientKind: "instructor" as const,
    subject: "Reminder — student is waiting for your review",
    previewText: "Hi Neil, student submitted their questionnaire 3 days ago…",
    context: JSON.stringify({
      instructorName: "Neil Gray",
      studentName: "Student",
    }),
    reason: "Student's questionnaire has been waiting 3+ days.",
  };
}

test("enqueue stages a pending row and ignores a duplicate", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorId } = await seed(t);
  const item = reviewItem(onboardingId, instructorId);

  const first = await t.mutation(internal.onboardingReminderReview.enqueue, {
    items: [item],
  });
  expect(first).toEqual({ inserted: 1, skipped: 0 });

  const second = await t.mutation(internal.onboardingReminderReview.enqueue, {
    items: [item],
  });
  expect(second).toEqual({ inserted: 0, skipped: 1 });

  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingReminders").collect()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("pending_review");
});

test("approve makes a staged row sendable and markSent flips it to sent", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorId } = await seed(t);
  await t.mutation(internal.onboardingReminderReview.enqueue, {
    items: [reviewItem(onboardingId, instructorId)],
  });

  const pending = await t.run(async (ctx) =>
    ctx.db.query("onboardingReminders").collect()
  );
  const id = pending[0]._id;

  const admin = t.withIdentity({ subject: "user_staff" });
  const review = await admin.mutation(api.onboardingReminderReview.review, {
    ids: [id],
    action: "approve",
  });
  expect(review.updated).toBe(1);

  const approved = await t.mutation(
    internal.onboardingReminderReview.claim,
    {}
  );
  expect(approved).toHaveLength(1);
  expect(approved[0].dedupeKey).toBe(
    `onboarding:${onboardingId}:instructor_review_3d:${instructorId}`
  );

  await t.mutation(internal.onboardingReminderReview.markSent, {
    dedupeKey: approved[0].dedupeKey,
    onboardingId: onboardingId as never,
    kind: "instructor_review_3d",
    recipient: "nrcgray@gmail.com",
    resendId: "resend-1",
  });

  const after = await t.mutation(internal.onboardingReminderReview.claim, {});
  expect(after).toHaveLength(0);

  const row = await t.run(async (ctx) => ctx.db.get(id));
  expect(row?.status).toBe("sent");
  expect(row?.sentAt).toBeTypeOf("number");
});

test("suppress needs a reason and stops the scan re-queueing the nudge", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { onboardingId, instructorId } = await seed(t, { createdAt: now });
  const item = reviewItem(onboardingId, instructorId);
  await t.mutation(internal.onboardingReminderReview.enqueue, { items: [item] });

  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingReminders").collect()
  );
  const id = rows[0]._id;
  const admin = t.withIdentity({ subject: "user_staff" });

  await expect(
    admin.mutation(api.onboardingReminderReview.review, {
      ids: [id],
      action: "suppress",
    })
  ).rejects.toThrow(/reason is required/i);

  const suppressed = await admin.mutation(api.onboardingReminderReview.review, {
    ids: [id],
    action: "suppress",
    reason: "Already working with this student",
  });
  expect(suppressed.updated).toBe(1);

  const mine = await t.run(async (ctx) => ctx.db.get(id));
  expect(mine?.status).toBe("suppressed");
  expect(mine?.suppressReason).toBe("Already working with this student");

  // The dedupe key is what the scan looks up, so the suppressed nudge never
  // comes back.
  const scan = await t.query(internal.onboardingFollowUps.scan, { now });
  expect(scan.instructorReviews).toHaveLength(0);
});

test("scan skips an instructor whose Clerk account is not linked", async () => {
  const t = convexTest(schema, modules);
  await seed(t, { instructorUserId: null });

  const scan = await t.query(internal.onboardingFollowUps.scan, {});
  expect(scan.instructorReviews).toHaveLength(0);
});

test("scan skips a pair that has already used a session", async () => {
  const t = convexTest(schema, modules);
  await seed(t, { packUsed: true });

  const scan = await t.query(internal.onboardingFollowUps.scan, {});
  expect(scan.instructorReviews).toHaveLength(0);
});

test("scan still queues the nudge for an active pair that has not met yet", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId } = await seed(t);

  const scan = await t.query(internal.onboardingFollowUps.scan, {});
  expect(scan.instructorReviews).toHaveLength(1);
  expect(scan.instructorReviews[0].onboardingId).toBe(onboardingId);
});

test("only staff can list or review the outbox", async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  await expect(t.query(api.onboardingReminderReview.listForReview, {})).rejects.toThrow(
    /Unauthorized/
  );

  const student = t.withIdentity({ subject: "user_student" });
  await expect(
    student.query(api.onboardingReminderReview.listForReview, {})
  ).rejects.toThrow(/Forbidden/);
});

test("claim drops a reminder whose precondition changed after approval", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorId, packId } = await seed(t);
  await t.mutation(internal.onboardingReminderReview.enqueue, {
    items: [reviewItem(onboardingId, instructorId)],
  });

  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingReminders").collect()
  );
  const id = rows[0]._id;
  const admin = t.withIdentity({ subject: "user_staff" });
  await admin.mutation(api.onboardingReminderReview.review, {
    ids: [id],
    action: "approve",
  });

  // The pair used a session while the reminder sat in the queue.
  await t.run(async (ctx) =>
    ctx.db.patch(packId, { remainingSessions: 3 })
  );

  const claimed = await t.mutation(internal.onboardingReminderReview.claim, {});
  expect(claimed).toHaveLength(0);

  const row = await t.run(async (ctx) => ctx.db.get(id));
  expect(row?.status).toBe("suppressed");
  expect(row?.suppressReason).toMatch(/session has already been used/i);
});

test("a claimed reminder cannot be suppressed by a late review", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorId } = await seed(t);
  await t.mutation(internal.onboardingReminderReview.enqueue, {
    items: [reviewItem(onboardingId, instructorId)],
  });

  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingReminders").collect()
  );
  const id = rows[0]._id;
  const admin = t.withIdentity({ subject: "user_staff" });
  await admin.mutation(api.onboardingReminderReview.review, {
    ids: [id],
    action: "approve",
  });

  const claimed = await t.mutation(internal.onboardingReminderReview.claim, {});
  expect(claimed).toHaveLength(1);

  const late = await admin.mutation(api.onboardingReminderReview.review, {
    ids: [id],
    action: "suppress",
    reason: "changed my mind",
  });
  expect(late.updated).toBe(0);

  const row = await t.run(async (ctx) => ctx.db.get(id));
  expect(row?.status).toBe("sending");
});

test("enqueue gives every row in a batch a distinct cursor value", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorId } = await seed(t);
  const base = reviewItem(onboardingId, instructorId);
  const items = Array.from({ length: 20 }, (_, index) => ({
    ...base,
    dedupeKey: `${base.dedupeKey}:batch-${index}`,
  }));

  await t.mutation(internal.onboardingReminderReview.enqueue, { items });

  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingReminders").collect()
  );
  const cursors = rows.map((row) => row.createdAt);
  expect(new Set(cursors).size).toBe(rows.length);
});

test("markSent records what an automatic send delivered", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId } = await seed(t);

  await t.mutation(internal.onboardingReminderReview.markSent, {
    dedupeKey: `onboarding:${onboardingId}:student_invite_48h`,
    onboardingId: onboardingId as never,
    kind: "student_invite_48h",
    recipient: "student@example.com",
    recipientName: "Student",
    recipientKind: "student",
    subject: "Reminder — finish setting up your Huckleberry mentorship",
    previewText: "Hi Student, finish setting up…",
    reason: "Student has no account after 2 day(s).",
    resendId: "resend-auto",
  });

  const admin = t.withIdentity({ subject: "user_staff" });
  const page = await admin.query(api.onboardingReminderReview.listForReview, {
    status: "sent",
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0].subject).toMatch(/finish setting up/);
  expect(page.items[0].previewText).toContain("finish setting up");
  expect(page.items[0].reason).toMatch(/no account/);
});
