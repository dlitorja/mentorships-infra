/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

// HUC-95 tests use `vi.useFakeTimers()` to keep the
// `ctx.scheduler.runAfter(0, ...)` enqueue deterministic
// across runs; the afterEach resets the timer mode so
// earlier tests (which use wall-clock `Date.now()` for
// stale-cutoff assertions) keep working.
afterEach(() => {
  vi.useRealTimers();
});

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
 *   - listStaleDraftsForReminder: respects per-reminder offset
 *     (`ONBOARDING_REMINDER_OFFSETS_MS[reminderCount]`) and the
 *     max-count cap (PR onboarding-reminder-cadence)
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

test("HUC-95: submitQuestionnaire does NOT pre-write notifiedInstructorAt (P1 #1 fix)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_huc95_a";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-huc95-a", email: "inst-huc95-a@example.com" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-huc95-a@example.com",
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

  const row = await t.run(async (ctx) => {
    return await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
  });
  expect(row).not.toBeNull();
  // Greptile round-1 P1 #1: the field is NOT pre-written
  // here — the action's idempotency check would otherwise
  // always short-circuit on its first run. The mutation
  // sets `status: submitted` only; the action sets
  // `notifiedInstructorAt` AFTER it successfully posts
  // to Inngest.
  expect((row as any).notifiedInstructorAt).toBeUndefined();
  expect((row as any).status).toBe("submitted");
});

test("HUC-95: submitQuestionnaire schedules notifyInstructorOnSubmission exactly once", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const studentId = "user_student_huc95_b";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-huc95-b", email: "inst-huc95-b@example.com" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-huc95-b@example.com",
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

  const scheduled = await t.run(async (ctx) => {
    return await ctx.db.system.query("_scheduled_functions").collect();
  });
  // The submit schedules exactly one action: the bridge to Inngest.
  // The email-send step is owned by Inngest itself, not Convex
  // scheduler — see apps/platform/inngest/functions/
  // onboarding-questionnaire-submitted-notification.ts.
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].name).toMatch(/notifyInstructorOnSubmission/);

  vi.useRealTimers();
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
  expect(newer.accepted).toBe(true);

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
  expect(older.accepted).toBe(false);

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
  expect(equal.accepted).toBe(false);

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
  expect(next.accepted).toBe(true);
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

test("saveQuestionnaireDraft force:true bypasses the older-id guard (tab-close beacon)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_force";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-force" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-force@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // Greptile round-27 P1 #14: a different tab (or an
  // earlier save in the same tab) has stored id=10. The
  // closing tab's beacon sends id=3, which would normally
  // be a no-op. With force:true the closing tab's payload
  // wins — it has the most recent user activity.
  // HUC-93: NEW first save; no existing.updatedAt to gate
  // against (the default is 0). payloadCapturedAt > 0 is
  // accepted; here Date.now() is fine.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "earlier" }],
      inspirations: [{ name: "Earlier" }],
      clientSaveId: 10,
    });

  // HUC-93: payloadCapturedAt is REQUIRED when force:true.
  // We send a future timestamp so the recency gate passes
  // (Date.now() + 1s > existing.updatedAt = "now" from the
  // previous mutation invocation).
  const beacon = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "closing" }],
      inspirations: [{ name: "Closing" }],
      clientSaveId: 3,
      force: true,
      payloadCapturedAt: Date.now() + 1_000,
    });
  expect(beacon.accepted).toBe(true);
  // Greptile round-28 P1 #15: forced overwrites bump
  // stored to max(stored + 1, clientSaveId) so the
  // counter never goes DOWN. The earlier save had
  // stored=10; the forced save with clientSaveId=3
  // bumps stored to 11.
  expect(beacon.storedClientSaveId).toBe(11);

  const row = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(row?.status).toBe("draft");
  expect(
    row?.answers.find((a: any) => a.questionId === "how_did_you_hear")?.answerText
  ).toBe("closing");
  expect(row?.inspirations[0]?.name).toBe("Closing");
});


test("listStaleDraftsForReminder picks up rows past the reminder-#1 offset (24h)", async () => {
  // PR onboarding-reminder-cadence: the threshold for reminder
  // #1 is `ONBOARDING_REMINDER_OFFSETS_MS[0]` = 24h. A row with
  // `reminderCount: 0` whose activity is older than that IS
  // eligible. The "0" timestamp below is well past 24h, so the
  // row is picked up.
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

// PR onboarding-reminder-cadence: per-reminder offset is keyed
// off `ONBOARDING_REMINDER_OFFSETS_MS[reminderCount]`. The tests
// below pin each of the three offsets with a "just shy of the
// threshold" + "just past the threshold" pair, so a future change
// to that array (or a regression that reverts to a single shared
// stale cutoff) trips the right test.

/** Stamp a draft row's freshness fields + reminder counters, then
 *  re-run the scan and return the candidate slice matching the
 *  given onboardingId (or `undefined`). */
async function runScanForOnboardingId(
  t: any,
  onboardingId: string,
  patch: { lastSeenAt: number; updatedAt: number; reminderCount?: number; lastReminderSentAt?: number }
): Promise<any[] | undefined> {
  await t.run(async (ctx: any) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q: any) => q.eq("onboardingId", onboardingId as any))
      .first();
    await ctx.db.patch(sub!._id, patch);
  });
  const page = await t.run(async (ctx: any) =>
    ctx.runQuery(internal.onboardingQuestionnaire.listStaleDraftsForReminder as any, { cursor: null })
  );
  const match = (page.candidates as any[]).find(
    (c: any) => c.onboardingId === onboardingId
  );
  return match;
}

test("listStaleDraftsForReminder uses reminder #1 offset of 24h", async () => {
  // 24h after the student's last activity (or, equivalently,
  // 24h after they walked away), reminder #1 becomes eligible.
  // 23h is just shy of that threshold and must NOT pick the row
  // up; 24h+1s must.
  const t = convexTest(schema, modules);
  const studentId = "user_student_11_rem1";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-11-rem1" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student11-rem1@example.com",
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

  const HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  // Just shy: 23h ago.
  expect(await runScanForOnboardingId(t, onboardingId, {
    lastSeenAt: now - 23 * HOUR_MS,
    updatedAt: now - 23 * HOUR_MS,
  })).toBeUndefined();
  // Just past: 24h ago minus 1s (i.e. 24h+1s of inactivity).
  expect((await runScanForOnboardingId(t, onboardingId, {
    lastSeenAt: now - 24 * HOUR_MS - 1_000,
    updatedAt: now - 24 * HOUR_MS - 1_000,
  }))?.onboardingId).toBe(onboardingId);
});

test("listStaleDraftsForReminder uses reminder #2 offset of 48h", async () => {
  // After reminder #1 has fired, the row needs to be quiet for
  // 48h (NOT 24h) before reminder #2 is eligible. A row with
  // reminderCount: 1 and 25h of inactivity must NOT re-pick-up
  // under the new per-reminder offset (it would under the old
  // shared 24h cutoff — covering that exact regression is the
  // point of this test).
  const t = convexTest(schema, modules);
  const studentId = "user_student_11_rem2";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-11-rem2" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student11-rem2@example.com",
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

  const HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  // 25h of inactivity past reminder #1 — must NOT pick up for #2.
  expect(await runScanForOnboardingId(t, onboardingId, {
    lastSeenAt: now - 25 * HOUR_MS,
    updatedAt: now - 25 * HOUR_MS,
    reminderCount: 1,
    lastReminderSentAt: now - 25 * HOUR_MS,
  })).toBeUndefined();
  // 48h+1s past reminder #1 — eligible for reminder #2.
  expect((await runScanForOnboardingId(t, onboardingId, {
    lastSeenAt: now - 48 * HOUR_MS - 1_000,
    updatedAt: now - 48 * HOUR_MS - 1_000,
    reminderCount: 1,
    lastReminderSentAt: now - 25 * HOUR_MS,
  }))?.onboardingId).toBe(onboardingId);
});

test("listStaleDraftsForReminder uses reminder #3 offset of 96h (~4 days)", async () => {
  // After reminder #2 has fired, the row needs ~4 days (96h) of
  // inactivity before reminder #3 is eligible. This is the
  // user-visible benefit of the cadence change — reminder #3 is
  // the "last call" nudge that sits inside a typical scheduling
  // window with the assigned mentor.
  const t = convexTest(schema, modules);
  const studentId = "user_student_11_rem3";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-11-rem3" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student11-rem3@example.com",
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

  const HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  // 95h past reminder #2 — must NOT pick up for #3.
  expect(await runScanForOnboardingId(t, onboardingId, {
    lastSeenAt: now - 95 * HOUR_MS,
    updatedAt: now - 95 * HOUR_MS,
    reminderCount: 2,
    lastReminderSentAt: now - 50 * HOUR_MS,
  })).toBeUndefined();
  // 96h+1s past reminder #2 — eligible for reminder #3 (the cap).
  expect((await runScanForOnboardingId(t, onboardingId, {
    lastSeenAt: now - 96 * HOUR_MS - 1_000,
    updatedAt: now - 96 * HOUR_MS - 1_000,
    reminderCount: 2,
    lastReminderSentAt: now - 96 * HOUR_MS - 1_000,
  }))?.onboardingId).toBe(onboardingId);
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

test("saveQuestionnaireDraft accepts empty answers + empty inspirations (intentional clear)", async () => {
  // Greptile round-23 P1 #1: a student who clears their
  // previously saved answers and then closes the tab must
  // still reach the server with the empty state. The
  // abandoned route distinguishes "supplied-as-empty" from
  // "absent" and the mutation itself must accept either.
  const t = convexTest(schema, modules);
  const studentId = "user_student_clear";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-clear" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-clear@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // Save non-empty first.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: VALID_ANSWERS,
      inspirations: VALID_INSPIRATIONS,
      clientSaveId: 1,
    });

  // Now save empty (intentional clear).
  const cleared = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [],
      inspirations: [],
      clientSaveId: 2,
    });
  expect(cleared.storedClientSaveId).toBe(2);
  expect(cleared.accepted).toBe(true);

  // Row should reflect the empty state.
  const row = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(row?.answers).toEqual([]);
  expect(row?.inspirations).toEqual([]);
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

test("saveQuestionnaireDraft force:true bypasses the older-id guard (tab-close beacon)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_force";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-force" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-force@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  // Greptile round-27 P1 #14: a different tab (or an
  // earlier save in the same tab) has stored id=10. The
  // closing tab's beacon sends id=3, which would normally
  // be a no-op. With force:true the closing tab's payload
  // wins — it has the most recent user activity.
  // HUC-93: NEW first save; no existing.updatedAt to gate
  // against (the default is 0). payloadCapturedAt > 0 is
  // accepted; here Date.now() is fine.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "earlier" }],
      inspirations: [{ name: "Earlier" }],
      clientSaveId: 10,
    });

  // HUC-93: payloadCapturedAt is REQUIRED when force:true.
  // We send a future timestamp so the recency gate passes
  // (Date.now() + 1s > existing.updatedAt = "now" from the
  // previous mutation invocation).
  const beacon = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [{ questionId: "how_did_you_hear", questionText: "How did you learn about this mentorship?", answerText: "closing" }],
      inspirations: [{ name: "Closing" }],
      clientSaveId: 3,
      force: true,
      payloadCapturedAt: Date.now() + 1_000,
    });
  expect(beacon.accepted).toBe(true);
  // Greptile round-28 P1 #15: forced overwrites bump
  // stored to max(stored + 1, clientSaveId) so the
  // counter never goes DOWN. The earlier save had
  // stored=10; the forced save with clientSaveId=3
  // bumps stored to 11.
  expect(beacon.storedClientSaveId).toBe(11);

  const row = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(row?.status).toBe("draft");
  expect(
    row?.answers.find((a: any) => a.questionId === "how_did_you_hear")?.answerText
  ).toBe("closing");
  expect(row?.inspirations[0]?.name).toBe("Closing");
});


// HUC-93: payload recency gate — the closing-tab beacon
// captures the user's last-edit timestamp and forwards it as
// `payloadCapturedAt`. The mutation's force:true path now
// rejects (accepted:false, no write) when the snapshot is
// strictly older than the server's `existing.updatedAt`.
// Without this gate, a stale sibling tab whose latest edits
// predate the active tab's could clobber the fresher edits.
//
// Helpers shared between the 4 spec cases below.
async function seedRecencyFixture(
  t: any,
  partial: { tabAEarlierTimestamp: number; tabBLaterTimestamp: number }
) {
  const studentId = "user_student_recency";
  const instructorId = await seedInstructor(t, {
    name: "Inst",
    slug: "inst-recency",
  });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-recency@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [
      { instructorId, isRenewal: false, sessionsPerInstructor: 4 },
    ],
  });
  return { studentId, onboardingId };
}

test("HUC-93: force:true rejects when payloadCapturedAt < existing.updatedAt", async () => {
  const t = convexTest(schema, modules);
  const { studentId, onboardingId } = await seedRecencyFixture(t, {
    tabAEarlierTimestamp: 0,
    tabBLaterTimestamp: 0,
  });

  // Tab B (the fresh one) saves first. We later pin the
  // server's `updatedAt` to a deterministic reference via
  // ctx.db.patch so the stale-payload test does not rely on
  // wall-clock arithmetic between the prior mutation's
  // execution and the new beacon's arrival.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "tabB",
        },
      ],
      inspirations: [{ name: "Tab B" }],
      clientSaveId: 10,
    });
  // Greptile P2 (test:1015): pin `updatedAt` to a fixed
  // reference. The prior version used `Date.now() - 1_000`
  // which couples to wall-clock delta between the prior
  // mutation and the Date.now() call site — a paused
  // runnable for >1s flips the comparison. Same pattern as
  // the equal/newer tests below.
  const nowRef = Date.now() + 5_000;
  await t.run(async (ctx: any) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q: any) =>
        q.eq("onboardingId", onboardingId as any)
      )
      .first();
    await ctx.db.patch(sub!._id, { updatedAt: nowRef });
  });

  // Tab A's beacon fires much later, but Tab A's snapshot
  // timestamp is from when Tab A was last edited (BEFORE
  // Tab B's save landed on the server). payloadCapturedAt
  // < nowRef ⇒ reject.
  const beacon = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "tabA-stale",
        },
      ],
      inspirations: [{ name: "Tab A" }],
      clientSaveId: 5,
      force: true,
      // Strictly older than the server's pinned `updatedAt`.
      payloadCapturedAt: nowRef - 1_000,
    });
  expect(beacon.accepted).toBe(false);
  // Same shape as the older-id-guard rejection: status:draft
  // with the existing clientSaveId echoed back untouched.
  expect(beacon.status).toBe("draft");
  expect(beacon.storedClientSaveId).toBe(10);

  // The row should still hold Tab B's payload — Tab A's
  // stale snapshot was rejected and never wrote.
  const row = await t
    .withIdentity({ subject: studentId })
    .query(api.onboardingQuestionnaire.getQuestionnaireForCurrentUser, {
      onboardingId: onboardingId as any,
    });
  expect(row?.answers.find((a: any) => a.questionId === "how_did_you_hear")
    ?.answerText).toBe("tabB");
});

test("HUC-93: force:true accepts when payloadCapturedAt === existing.updatedAt", async () => {
  const t = convexTest(schema, modules);
  const { studentId, onboardingId } = await seedRecencyFixture(t, {
    tabAEarlierTimestamp: 0,
    tabBLaterTimestamp: 0,
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "baseline",
        },
      ],
      inspirations: [{ name: "Baseline" }],
      clientSaveId: 7,
    });

  // Pin the server's updatedAt to a known value via a
  // raw patch (sneaking around the mutation's auto-stamp).
  const nowRef = Date.now() + 5_000;
  await t.run(async (ctx: any) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q: any) =>
        q.eq("onboardingId", onboardingId as any)
      )
      .first();
    await ctx.db.patch(sub!._id, { updatedAt: nowRef });
  });

  // Tab A's snapshot was JUST before the other tab's save
  // landed server-side, but we're conservative: capture-time
  // is `equal` to the server's updatedAt — SPEC says equal
  // is OK.
  const beacon = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "tabA-equal",
        },
      ],
      inspirations: [{ name: "Tab A" }],
      clientSaveId: 3,
      force: true,
      payloadCapturedAt: nowRef,
    });
  expect(beacon.accepted).toBe(true);
  expect(beacon.status).toBe("draft");
  // Greptile round-28 P1 #15: forced overwrites bump
  // stored to max(stored + 1, clientSaveId) regardless.
  expect(beacon.storedClientSaveId).toBe(Math.max(7 + 1, 3));
});

test("HUC-93: force:true accepts and bumps stored when payloadCapturedAt > existing.updatedAt", async () => {
  const t = convexTest(schema, modules);
  const { studentId, onboardingId } = await seedRecencyFixture(t, {
    tabAEarlierTimestamp: 0,
    tabBLaterTimestamp: 0,
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "baseline",
        },
      ],
      inspirations: [{ name: "Baseline" }],
      clientSaveId: 5,
    });

  // Pin the server's updatedAt so we have a stable lower
  // bound. Tab A's snapshot is NEWER than that bound, so
  // force:true should accept and bump the stored counter.
  const nowRef = Date.now() + 5_000;
  await t.run(async (ctx: any) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q: any) =>
        q.eq("onboardingId", onboardingId as any)
      )
      .first();
    await ctx.db.patch(sub!._id, { updatedAt: nowRef });
  });

  const beacon = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "tabA-newer",
        },
      ],
      inspirations: [{ name: "Tab A" }],
      clientSaveId: 4,
      force: true,
      payloadCapturedAt: nowRef + 2_000,
    });
  expect(beacon.accepted).toBe(true);
  expect(beacon.status).toBe("draft");
  expect(beacon.storedClientSaveId).toBe(Math.max(5 + 1, 4));
});

test("HUC-93: force:false path ignores payloadCapturedAt (existing strict-greater-than logic unchanged)", async () => {
  const t = convexTest(schema, modules);
  const { studentId, onboardingId } = await seedRecencyFixture(t, {
    tabAEarlierTimestamp: 0,
    tabBLaterTimestamp: 0,
  });

  // Server already has a more-recent save at id=10. The
  // client save sends id=3 (older) without `force`, AND
  // supplies a payloadCapturedAt that, if the gate were
  // wired in, would be ignored for non-forced saves. The
  // existing strict-greater-than guard rejects.
  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "baseline",
        },
      ],
      inspirations: [{ name: "Baseline" }],
      clientSaveId: 10,
    });

  const result = await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "stale",
        },
      ],
      inspirations: [{ name: "Stale" }],
      clientSaveId: 3,
      // explicitly NOT force. payloadCapturedAt is a
      // forward-compatible annotation: the handler MUST
      // ignore it on the non-forced path.
      payloadCapturedAt: Date.now(),
    });
  expect(result.accepted).toBe(false);
  expect(result.status).toBe("draft");
  expect(result.storedClientSaveId).toBe(10);
});

test("HUC-93: force:true throws when payloadCapturedAt is missing", async () => {
  const t = convexTest(schema, modules);
  const { studentId, onboardingId } = await seedRecencyFixture(t, {
    tabAEarlierTimestamp: 0,
    tabBLaterTimestamp: 0,
  });

  await t
    .withIdentity({ subject: studentId })
    .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
      onboardingId: onboardingId as any,
      questionnaireVersion: 1,
      answers: [
        {
          questionId: "how_did_you_hear",
          questionText: "How did you learn about this mentorship?",
          answerText: "baseline",
        },
      ],
      inspirations: [{ name: "Baseline" }],
      clientSaveId: 5,
    });

  // force:true with no payloadCapturedAt is a contract
  // violation: the closing-tab beacon MUST send a snapshot
  // timestamp. Reject loudly so a client regression is
  // visible in `reportError` rather than silently accepted.
  await expect(
    t
      .withIdentity({ subject: studentId })
      .mutation(api.onboardingQuestionnaire.saveQuestionnaireDraft, {
        onboardingId: onboardingId as any,
        questionnaireVersion: 1,
        answers: [
          {
            questionId: "how_did_you_hear",
            questionText: "How did you learn about this mentorship?",
            answerText: "missing-ts",
          },
        ],
        inspirations: [{ name: "Missing" }],
        clientSaveId: 7,
        force: true,
        // intentionally omit payloadCapturedAt
      })
  ).rejects.toThrow(/payloadCapturedAt/);
});

test("saveQuestionnaireDraft seeds reminderCount: 0 on first insert (reminder-scan P2)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_seed";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-seed" });
  const onboardingId = await seedAdminOnboarding(t, {
    email: "student-seed@example.com",
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

  // Reminder-scan P2: new inserts must seed reminderCount: 0
  // so the row immediately participates in the
  // `by_status_reminderCount_updatedAt` index range used by
  // the cron (Convex excludes rows whose optional field is
  // undefined from the index).
  const row = await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId as any))
      .first();
    return sub;
  });
  expect(row?.reminderCount).toBe(0);
});

test("backfillReminderCountZeroForLegacyDrafts patches only rows with undefined reminderCount", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_backfill";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-backfill" });

  // Row A: legacy shape (no reminderCount). Must be patched.
  const onboardingA = await seedAdminOnboarding(t, {
    email: "student-backfill-a@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });
  // Row B: legacy shape (no reminderCount). Must be patched.
  const onboardingB = await seedAdminOnboarding(t, {
    email: "student-backfill-b@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });
  // Row C: pre-existing reminderCount: 1. Migration must leave
  // it alone.
  const onboardingC = await seedAdminOnboarding(t, {
    email: "student-backfill-c@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId: onboardingA as any,
      studentClerkId: studentId,
      questionnaireVersion: 1,
      status: "draft",
      answers: [],
      inspirations: [],
      createdAt: Date.now() - 2 * 60 * 60 * 1000,
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
    });
    await ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId: onboardingB as any,
      studentClerkId: studentId,
      questionnaireVersion: 1,
      status: "draft",
      answers: [],
      inspirations: [],
      createdAt: Date.now() - 2 * 60 * 60 * 1000,
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
    });
    await ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId: onboardingC as any,
      studentClerkId: studentId,
      questionnaireVersion: 1,
      status: "draft",
      answers: [],
      inspirations: [],
      createdAt: Date.now() - 2 * 60 * 60 * 1000,
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      reminderCount: 1,
    });
  });

  const result = await t.run(async (ctx) =>
    ctx.runMutation(
      internal.onboardingQuestionnaire.backfillReminderCountZeroForLegacyDrafts as any,
      { cursor: null }
    )
  );
  expect(result.scanned).toBe(3);
  expect(result.patched).toBe(2);
  expect(result.isDone).toBe(true);

  // Re-run is idempotent — should patch zero rows on the second pass.
  const result2 = await t.run(async (ctx) =>
    ctx.runMutation(
      internal.onboardingQuestionnaire.backfillReminderCountZeroForLegacyDrafts as any,
      { cursor: null }
    )
  );
  expect(result2.scanned).toBe(3);
  expect(result2.patched).toBe(0);

  // The pre-existing reminderCount: 1 row must not be touched.
  const untouched = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "draft"))
      .collect();
    return rows.find((r: any) => r.reminderCount === 1);
  });
  expect(untouched).toBeDefined();
  expect(untouched?.reminderCount).toBe(1);
});

test("backfillReminderCountZeroForLegacyDrafts drains >200 rows via cursor (Greptile round-1 P1)", async () => {
  const t = convexTest(schema, modules);
  const studentId = "user_student_paginate";
  const instructorId = await seedInstructor(t, { name: "Inst", slug: "inst-paginate" });

  // Greptile round-1 P1: the cursor must advance the
  // scan. We seed 201 legacy rows so the second call
  // drains the leftover 1 row instead of re-patching the
  // same first 200. We bypass `seedAdminOnboarding` (slow)
  // and insert the submissions rows directly with a
  // placeholder onboardingId — the backfill only reads the
  // index, never resolves the parent.
  const TOTAL = 201;
  const placeholderOnboardingId = await seedAdminOnboarding(t, {
    email: "student-page-base@example.com",
    status: "queued",
    assignedStudentClerkId: studentId,
    perInstructor: [{ instructorId, isRenewal: false, sessionsPerInstructor: 4 }],
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < TOTAL; i++) {
      await ctx.db.insert("onboardingQuestionnaireSubmissions", {
        onboardingId: placeholderOnboardingId as any,
        studentClerkId: studentId,
        questionnaireVersion: 1,
        status: "draft",
        answers: [],
        inspirations: [],
        createdAt: Date.now() - 2 * 60 * 60 * 1000 + i,
        updatedAt: Date.now() - 2 * 60 * 60 * 1000 + i,
      });
    }
  });

  // First call: patches 200, isDone: false, returns
  // continueCursor.
  const first = await t.run(async (ctx) =>
    ctx.runMutation(
      internal.onboardingQuestionnaire.backfillReminderCountZeroForLegacyDrafts as any,
      { cursor: null }
    )
  );
  expect(first.scanned).toBe(200);
  expect(first.patched).toBe(200);
  expect(first.isDone).toBe(false);
  expect(typeof first.continueCursor).toBe("string");

  // Second call: pass the cursor back in. Must drain the
  // remaining 1 row, NOT re-patch the first 200.
  const second = await t.run(async (ctx) =>
    ctx.runMutation(
      internal.onboardingQuestionnaire.backfillReminderCountZeroForLegacyDrafts as any,
      { cursor: first.continueCursor }
    )
  );
  expect(second.scanned).toBe(1);
  expect(second.patched).toBe(1);
  expect(second.isDone).toBe(true);

  // Third call with no cursor: the page reads the first
  // 200 rows (now patched in the first call, so
  // `patched: 0`). `scanned` is the page size (200), not
  // the table size — we verify nothing was patched
  // because the cursor reset did not re-process
  // already-patched rows. (isDone is `false` because the
  // leftover 1 row from the second call sits past the
  // first page; draining it requires another cursor pass
  // — which would also patch nothing.)
  const third = await t.run(async (ctx) =>
    ctx.runMutation(
      internal.onboardingQuestionnaire.backfillReminderCountZeroForLegacyDrafts as any,
      { cursor: null }
    )
  );
  expect(third.scanned).toBe(200);
  expect(third.patched).toBe(0);
});
