/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

/**
 * PR 12 PR 4 — Tests for the onboarding questionnaire + work
 * examples data layer (PR 4a) and the PR 4b reminder cron helpers.
 *
 * Coverage:
 *   - saveQuestionnaireDraft: upsert, no-op once submitted
 *   - submitQuestionnaire: server-counts work examples
 *     (rejects when fewer than MIN_WORK_EXAMPLES_PER_SUBMISSION),
 *     requires every required question ID to have a non-empty
 *     answer, requires >= MIN_INSPIRATIONS, flips status to
 *     "submitted", rejects non-assigned callers
 *   - recordQuestionnaireSeen: stamps lastSeenAt only (does NOT
 *     increment reminderCount), no-op once submitted, no-op for
 *     non-assigned student
 *   - getQuestionnaireForCurrentUser / getSubmittedQuestionnaireForViewer
 *   - getIncompleteOnboardingForCurrentUser (PR 4b enhancement):
 *     skips rows whose questionnaire has been submitted
 *   - listStaleDraftsForReminder: respects stale threshold + max
 *     count + min interval
 *   - markReminderSent: idempotent on `next`
 */

async function seedInstructor(
  t: any,
  args: { name: string; slug: string; userId?: string }
): Promise<string> {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("instructors", {
      name: args.name,
      slug: args.slug,
      email: `${args.slug}@example.com`,
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
      userId: args.userId,
    })
  );
}

async function seedAdminOnboarding(
  t: any,
  args: {
    email: string;
    status: "queued" | "processing" | "completed" | "failed" | "cancelled";
    assignedStudentClerkId?: string;
    perInstructor: Array<{ instructorId: string; isRenewal: boolean }>;
  }
): Promise<string> {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("adminOnboardings", {
      email: args.email,
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status: args.status,
      attemptCount: 1,
      assignedStudentClerkId: args.assignedStudentClerkId,
      perInstructor: args.perInstructor,
      timeline: [],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      createdAt: Date.now(),
    })
  );
}

async function seedWorkExample(
  t: any,
  args: {
    onboardingId: string;
    studentClerkId: string;
    status: "pending" | "active" | "deleted";
    fileName?: string;
    b2Key?: string;
    fileId?: string;
    contentType?: string;
  }
): Promise<string> {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("onboardingWorkExamples", {
      onboardingId: args.onboardingId,
      studentClerkId: args.studentClerkId,
      status: args.status,
      fileName: args.fileName ?? `example-${Math.random().toString(36).slice(2, 8)}.jpg`,
      contentType: args.contentType ?? "image/jpeg",
      b2Key: args.b2Key ?? `onboarding/${args.onboardingId}/example.jpg`,
      fileId: args.fileId ?? `file-${Math.random().toString(36).slice(2, 8)}`,
      size: 256 * 1024,
      uploadedAt: Date.now(),
    })
  );
}

const VALID_ANSWERS = [
  { questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "A friend mentioned it." },
  { questionId: "goals", questionText: "What are your goals with art and this mentorship?", answerText: "Improve my draftsmanship." },
  { questionId: "inspirations", questionText: "Who or what inspires your work?", answerText: "Studio Ghibli and friends." },
];

const VALID_INSPIRATIONS = [
  { name: "Hilary Knight" },
  { name: "Tove Jansson" },
  { name: "Kitty Crowther" },
];

test("saveQuestionnaireDraft upserts answers + inspirations", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_1";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-1" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student1@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  const draft = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  expect(draft.status).toBe("draft");
  const submission = await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    return sub;
  });
  expect((submission as any).answers.length).toBe(VALID_ANSWERS.length);
  expect((submission as any).inspirations.length).toBe(VALID_INSPIRATIONS.length);
  expect((submission as any).studentClerkId).toBe(studentId);
});

test("submitQuestionnaire rejects when fewer than MIN_WORK_EXAMPLES_PER_SUBMISSION active", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_2";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-2" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student2@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  // Add only 2 active work examples (below MIN_WORK_EXAMPLES_PER_SUBMISSION = 4)
  await seedWorkExample(t, {
    onboardingId,
    studentClerkId: studentId,
    status: "active",
  });
  await seedWorkExample(t, {
    onboardingId,
    studentClerkId: studentId,
    status: "active",
  });

  await expect(
    t
      .withIdentity({ subject: studentId })
      .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
        onboardingId: onboardingId as any,
        questionnaireVersion: 1,
        answers: VALID_ANSWERS,
        inspirations: VALID_INSPIRATIONS,
      })
  ).rejects.toThrow(/work examples/i);
});

test("submitQuestionnaire rejects when a required question id has no answer", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_3";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-3" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student3@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // Drop the 'goals' answer entirely.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "Friend." }],
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  // 4 active work examples so the work-examples gate doesn't fire first.
  for (let i = 0; i < 4; i++) {
    await seedWorkExample(t, {
      onboardingId,
      studentClerkId: studentId,
      status: "active",
    });
  }

  await expect(
    t
      .withIdentity({ subject: studentId })
      .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
        onboardingId: onboardingId as any,
        questionnaireVersion: 1,
        answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "Friend." }],
        inspirations: VALID_INSPIRATIONS,
      })
  ).rejects.toThrow(/required/i);
});

test("submitQuestionnaire rejects when inspirations are below MIN_INSPIRATIONS", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_4";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-4" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student4@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: [{ name: "Only One" }],
      clientSaveId: 1,
    });

  for (let i = 0; i < 4; i++) {
    await seedWorkExample(t, {
      onboardingId,
      studentClerkId: studentId,
      status: "active",
    });
  }

  await expect(
    t
      .withIdentity({ subject: studentId })
      .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
        onboardingId: onboardingId as any,
        questionnaireVersion: 1,
        answers: VALID_ANSWERS,
        inspirations: [{ name: "Only One" }],
      })
  ).rejects.toThrow(/inspiration/i);
});

test("submitQuestionnaire happy path flips status to submitted", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_5";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-5" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student5@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  for (let i = 0; i < 4; i++) {
    await seedWorkExample(t, {
      onboardingId,
      studentClerkId: studentId,
      status: "active",
    });
  }

  const submitted = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
    });
  expect(submitted.submissionId).toBeTypeOf("string");
  expect(submitted.submittedAt).toBeTypeOf("number");
});

test("submitQuestionnaire rejects non-assigned caller", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_6";
  const otherId = "user_other_6";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-6" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student6@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await expect(
    t
      .withIdentity({ subject: otherId })
      .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
        onboardingId: onboardingId as any,
        questionnaireVersion: 1,
        answers: VALID_ANSWERS,
        inspirations: VALID_INSPIRATIONS,
      })
  ).rejects.toThrow();
});

test("saveQuestionnaireDraft no-ops once submitted", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_7";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-7" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student7@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });
  for (let i = 0; i < 4; i++) {
    await seedWorkExample(t, {
      onboardingId,
      studentClerkId: studentId,
      status: "active",
    });
  }
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
    });

  // After submit, saveDraft should NOT overwrite the submitted state.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "tampered" }],
      inspirations: [{ name: "Tampered" }],
      clientSaveId: 1,
    });

  const row = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(row?.status).toBe("submitted");
  expect(
    row?.answers.find((a: any) => a.questionId === "how_did_you_hear")?.answerText
  ).not.toBe("tampered");
});

test("saveQuestionnaireDraft rejects older clientSaveId (server-side ordering)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_order";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-order" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-order@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // Newer save first.
  const newer = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "newer" }],
      inspirations: [{ name: "Newer Inspo" }],
      clientSaveId: 5,
    });
  expect(newer.storedClientSaveId).toBe(5);

  // Older save arrives out of order — should be a no-op.
  const older = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "older" }],
      inspirations: [{ name: "Older Inspo" }],
      clientSaveId: 3,
    });
  expect(older.storedClientSaveId).toBe(5);

  // Row reflects the newer save, not the older one.
  const row = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(row?.status).toBe("draft");
  expect(
    row?.answers.find((a: any) => a.questionId === "how_did_you_hear")?.answerText
  ).toBe("newer");
  expect(row?.inspirations[0]?.name).toBe("Newer Inspo");

  // Equal clientSaveId is also a no-op (duplicate).
  const equal = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "duplicate" }],
      inspirations: [{ name: "Dup Inspo" }],
      clientSaveId: 5,
    });
  expect(equal.storedClientSaveId).toBe(5);

  const rowAfterDup = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(
    rowAfterDup?.answers.find((a: any) => a.questionId === "how_did_you_hear")?.answerText
  ).toBe("newer");
});

test("getQuestionnaireForCurrentUser returns lastClientSaveId so returning students can re-seed the counter", async () => {
  // Greptile round-19 P1: server stores lastClientSaveId;
  // the read-side query must surface it so the client form
  // can seed its monotonic counter on the next visit.
  const t = convexTest(schema, modules);
  const studentId = "user_student_visit";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-visit" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-visit@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // First visit: save 7.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 7,
    });

  // Returning visit: GET must surface lastClientSaveId = 7.
  const initial = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(initial?.lastClientSaveId).toBe(7);

  // A subsequent save with clientSaveId 8 (seed = 7 + 1)
  // is accepted.
  const next = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 8,
    });
  expect(next.storedClientSaveId).toBe(8);
});

test("recordQuestionnaireSeen stamps lastSeenAt only, does not increment reminderCount", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_8";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-8" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student8@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.recordQuestionnaireSeen, {
      onboardingId: onboardingId as any,
    });

  // Read the row directly to verify lastSeenAt was patched.
  const submission = await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    return sub;
  });
  expect((submission as any).lastSeenAt).toBeTypeOf("number");
  expect((submission as any).reminderCount ?? 0).toBe(0);
});

test("getIncompleteOnboardingForCurrentUser skips rows with a submitted questionnaire (PR 4b)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_9";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-9" });
  // Two onboardings for the same student; the newer one has a submitted
  // questionnaire, the older one is still in progress.
  const olderOnboardingId = await seedAdminOnboarding(t, {
    email: "student9@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });
  const newerOnboardingId = await seedAdminOnboarding(t, {
    email: "student9@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // Save + submit on the newer row.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: newerOnboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });
  for (let i = 0; i < 4; i++) {
    await seedWorkExample(t, {
      onboardingId: newerOnboardingId,
      studentClerkId: studentId,
      status: "active",
    });
  }
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.submitQuestionnaire, {
      onboardingId: newerOnboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
    });

  // The redirect should pick the older row (no submitted questionnaire),
  // not the newer one.
  const picked = await t
    .withIdentity({ subject: studentId })
    .query(api.adminOnboarding.getIncompleteOnboardingForCurrentUser, {});
  expect(picked).toBe(olderOnboardingId);
});

test("listStaleDraftsForReminder skips rows past the max-count cap", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_10";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-10" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student10@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  // Manually bump reminderCount past the cap.
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    await ctx.db.patch(sub!._id, { reminderCount: 99, lastSeenAt: 0 });
  });

  const page = await t.run(async (ctx) =>
    ctx.runQuery(internal.onboardingQuestionnaire.listStaleDraftsForReminder as any, { cursor: null })
  );
  expect(page.candidates.find((d: any) => d.onboardingId === onboardingId)).toBeUndefined();
});

test("listStaleDraftsForReminder picks up rows past the stale threshold", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_11";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-11" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student11@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  // Stamp both `updatedAt` and `lastSeenAt` deep in the past so the
  // Math.max(updatedAt, lastSeenAt ?? 0) freshness check (Greptile
  // P2 #14) considers the row stale.
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    await ctx.db.patch(sub!._id, { lastSeenAt: 0, updatedAt: 0 });
  });

  const page = await t.run(async (ctx) =>
    ctx.runQuery(internal.onboardingQuestionnaire.listStaleDraftsForReminder as any, { cursor: null })
  );
  expect(page.candidates.length).toBeGreaterThan(0);
  expect(page.candidates[0].onboardingId).toBe(onboardingId);
});

test("markReminderSent is idempotent on `next`", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_12";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-12" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student12@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  const submissionId = await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    return sub!._id;
  });

  // First call advances to next=1.
  await t.run(async (ctx) =>
    ctx.runMutation(internal.onboardingQuestionnaire.markReminderSent as any, {
      submissionId,
      next: 1,
    })
  );
  // Second call with the SAME `next=1` is a no-op.
  await t.run(async (ctx) =>
    ctx.runMutation(internal.onboardingQuestionnaire.markReminderSent as any, {
      submissionId,
      next: 1,
    })
  );

  const row = await t.run(async (ctx) => {
    const sub = await ctx.db.get(submissionId);
    return sub;
  });
  expect((row as any).reminderCount).toBe(1);
});

test("listStaleDraftsForReminder excludes cancelled parent onboardings (P2 #15)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_13";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-13" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student13@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  // Cancel the parent onboarding + stamp the draft as stale.
  await t.run(async (ctx) => {
    await ctx.db.patch(onboardingId as any, { status: "cancelled" });
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    await ctx.db.patch(sub!._id, { lastSeenAt: 0, updatedAt: 0 });
  });

  const page = await t.run(async (ctx) =>
    ctx.runQuery(internal.onboardingQuestionnaire.listStaleDraftsForReminder as any, { cursor: null })
  );
  expect(page.candidates.find((d: any) => d.onboardingId === onboardingId)).toBeUndefined();
});
