/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // INNGEST_EVENT_KEY is a typed env declared in
  // `convex/convex.config.ts` and surfaced via
  // `ctx.env.get("INNGEST_EVENT_KEY", { allowMissing: true })`
  // in the action under test. We seed it here so the
  // success-path tests can exercise the fetch branch.
  process.env.INNGEST_EVENT_KEY = "test-inngest-event-key";
});

afterEach(() => {
  delete process.env.INNGEST_EVENT_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  // Defensive: this test file never uses fake timers, but a
  // sibling test file's leftover `useFakeTimers` would leak
  // here otherwise. Real-timers is the cheap default.
  vi.useRealTimers();
});

/**
 * Seed a submitted questionnaire row directly via DB writes
 * so the action-under-test sees a row with
 * `notifiedInstructorAt: null` (the post-`submitQuestionnaire`
 * state would otherwise pre-write the idempotency claim,
 * which is correct production behaviour but unhelpful for
 * tests that need to exercise the action's fetch paths).
 *
 * Mirrors the seed shape produced by `submitQuestionnaire`
 * so the action-under-test sees an identical read.
 */
async function seedSubmittedQuestionnaire(t: ReturnType<typeof convexTest>) {
  const studentId = "user_student_huc95_action";
  const now = Date.now();
  const onboardingId = await t.run(async (ctx) =>
    ctx.db.insert("adminOnboardings", {
      email: "student-huc95-action@example.com",
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status: "queued",
      attemptCount: 1,
      assignedStudentClerkId: studentId,
      perInstructor: [],
      timeline: [],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      createdAt: now,
    })
  );
  const submissionId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId,
      studentClerkId: studentId,
      questionnaireVersion: 1,
      status: "submitted",
      answers: [],
      inspirations: [],
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      // Intentionally NOT setting `notifiedInstructorAt`
      // here — the action-under-test exercises the un-notified
      // path, which is the only path that does a fetch.
    })
  );
  return { studentId, onboardingId, submissionId };
}

test("HUC-95: notifyInstructorOnSubmission emits Inngest event with correct payload on a freshly-submitted row", async () => {
  const t = convexTest(schema, modules);
  const { submissionId, onboardingId } = await seedSubmittedQuestionnaire(t);

  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await t.action(internal.onboardingQuestionnaireActions.notifyInstructorOnSubmission, {
    submissionId: submissionId as any,
  });

  expect(result).toEqual({ emitted: true, eventName: "questionnaire/submitted" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = fetchMock.mock.calls[0];
  expect(String(calledUrl)).toBe("https://inn.gs/e/questionnaire/submitted");
  expect((calledInit as RequestInit).method).toBe("POST");
  const headers = (calledInit as RequestInit).headers as Record<string, string>;
  expect(headers["Content-Type"]).toBe("application/json");
  expect(headers["Authorization"]).toBe("Bearer test-inngest-event-key");
  const payload = JSON.parse((calledInit as RequestInit).body as string);
  expect(payload).toMatchObject({
    name: "questionnaire/submitted",
    data: {
      submissionId,
      onboardingId,
      studentClerkId: "user_student_huc95_action",
    },
  });
  expect(typeof payload.data.submittedAt).toBe("number");

  // Greptile round-1 P1 #1 invariant: on a successful
  // emit the action writes `notifiedInstructorAt` via
  // `markInstructorNotified`. A re-fire of the action
  // then sees the field set and short-circuits.
  const rowAfter = await t.run(async (ctx) => ctx.db.get(submissionId as any));
  expect(rowAfter!.notifiedInstructorAt).toEqual(expect.any(Number));
  expect(rowAfter!.notifiedInstructorAt).toBeGreaterThan(0);
});

test("HUC-95: notifyInstructorOnSubmission is a no-op when notifiedInstructorAt is already set (idempotency)", async () => {
  const t = convexTest(schema, modules);
  const { submissionId } = await seedSubmittedQuestionnaire(t);

  // Simulate a Convex scheduler replay by pre-patching
  // the field that the action's idempotency check reads.
  await t.run(async (ctx) => {
    const sub = await ctx.db.get(submissionId as any);
    await ctx.db.patch(sub!._id, { notifiedInstructorAt: Date.now() });
  });

  const fetchMock = vi.fn(async () => {
    throw new Error("fetch should not have been called for an already-notified row");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await t.action(internal.onboardingQuestionnaireActions.notifyInstructorOnSubmission, {
    submissionId: submissionId as any,
  });

  expect(result).toMatchObject({ skipped: true });
  // The reason string is documented; allow either spelling
  // ("notifiedInstructorAt" or "status") because the action
  // returns one of two skip messages depending on which
  // gate fires first.
  expect((result as { reason: string }).reason).toMatch(
    /notifiedInstructorAt|submitted/i
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("HUC-95: notifyInstructorOnSubmission returns skipped=true on a draft row (rollback race)", async () => {
  const t = convexTest(schema, modules);
  // Synthesise a draft row directly in DB so the test
  // doesn't have to mimic the mutation flow.
  const studentId = "user_student_huc95_draft";
  const onboardingId = await t.run(async (ctx) =>
    ctx.db.insert("adminOnboardings", {
      email: "student-huc95-draft@example.com",
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status: "queued",
      attemptCount: 1,
      assignedStudentClerkId: studentId,
      perInstructor: [],
      timeline: [],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      createdAt: Date.now(),
    })
  );
  const submissionId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingQuestionnaireSubmissions", {
      onboardingId,
      studentClerkId: studentId,
      questionnaireVersion: 1,
      status: "draft",
      answers: [],
      inspirations: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );

  const fetchMock = vi.fn(async () => {
    throw new Error("fetch should NOT be invoked for a non-submitted row");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await t.action(internal.onboardingQuestionnaireActions.notifyInstructorOnSubmission, {
    submissionId: submissionId as any,
  });

  expect(result).toMatchObject({ skipped: true });
  expect((result as { reason: string }).reason).toMatch(/draft/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("HUC-95: notifyInstructorOnSubmission returns skipped=true when INNGEST_EVENT_KEY is missing", async () => {
  delete process.env.INNGEST_EVENT_KEY;
  const t = convexTest(schema, modules);
  const { submissionId } = await seedSubmittedQuestionnaire(t);

  const fetchMock = vi.fn(async () => {
    throw new Error("fetch should NOT be invoked without INNGEST_EVENT_KEY");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await t.action(internal.onboardingQuestionnaireActions.notifyInstructorOnSubmission, {
    submissionId: submissionId as any,
  });

  expect(result).toMatchObject({ skipped: true });
  expect((result as { reason: string }).reason).toMatch(/INNGEST_EVENT_KEY/i);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("HUC-95: notifyInstructorOnSubmission throws when the Inngest ingest returns 5xx (scheduler will retry)", async () => {
  const t = convexTest(schema, modules);
  const { submissionId } = await seedSubmittedQuestionnaire(t);

  globalThis.fetch = vi.fn(async () => {
    return new Response("upstream-down", { status: 503 });
  }) as unknown as typeof fetch;

  await expect(
    t.action(internal.onboardingQuestionnaireActions.notifyInstructorOnSubmission, {
      submissionId: submissionId as any,
    })
  ).rejects.toThrow(/5xx|503/);
});

test("HUC-95: notifyInstructorOnSubmission returns a clean skip on Inngest 4xx (no retry)", async () => {
  const t = convexTest(schema, modules);
  const { submissionId } = await seedSubmittedQuestionnaire(t);

  globalThis.fetch = vi.fn(async () => {
    return new Response("event-key-rejected", { status: 401 });
  }) as unknown as typeof fetch;

  const result = await t.action(internal.onboardingQuestionnaireActions.notifyInstructorOnSubmission, {
    submissionId: submissionId as any,
  });

  expect(result).toMatchObject({ skipped: true });
  expect((result as { reason: string }).reason).toMatch(/401/i);
});
