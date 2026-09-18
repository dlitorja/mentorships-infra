/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const originalFetch = globalThis.fetch;

/**
 * Tests for the visibility-gate predicate at
 * `convex/sessions.ts:getSessionVisibilityForStudentOwner` and the
 * state-machine CRUD in
 * `convex/recordingReadyNotifications.ts`.
 *
 * The visibility gate is the single point where we decide whether
 * the student will be notified — it must reject every reason a
 * recording might appear in the database but NOT appear in the
 * student's `getCallRecordingsForWorkspace` result. The five
 * reason branches are tested below with one test each.
 */

type SeededFixtures = {
  instructorId: string;
  sessionId: string;
  studentUserId: string;
};

async function seedInstructorAndSession(
  t: ReturnType<typeof convexTest>
): Promise<{ instructorId: string; sessionId: string }> {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_rrn",
      email: "instructor-rrn@example.com",
      name: "Test Instructor",
      slug: "test-instructor-rrn",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_rrn",
      scheduledAt: Date.now() - 5_000,
      status: "completed",
      recordingConsent: true,
      callStartedAt: Date.now() - 5_000,
      recordingTransferStatus: "ready",
      recordingUrl: "recordings/test/rec.mp4",
      hasRecordingArtifact: true,
    });
    return { instructorId, sessionId };
  });
}

async function seedWorkspaceForPair(
  t: ReturnType<typeof convexTest>,
  instructorId: string,
  ownerUserId: string
): Promise<string> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: ownerUserId,
      instructorId: instructorId as any,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });
}

test("getSessionVisibilityForStudentOwner: ok when workspace resolves to recipient", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionId } = await seedInstructorAndSession(t);
  const studentUserId = "user_student_rrn";
  await seedWorkspaceForPair(t, instructorId, studentUserId);
  // Link the session to the workspace so resolveSessionWorkspace
  // doesn't fall through to the pack/pair path (deterministic).
  await t.run(async (ctx) => {
    const workspaceId = await ctx.db
      .query("workspaces")
      .withIndex("by_instructorId_ownerId", (q) =>
        q
          .eq("instructorId", instructorId as any)
          .eq("ownerId", studentUserId)
      )
      .first();
    if (!workspaceId) throw new Error("workspace missing in test");
    await ctx.db.patch(sessionId, { workspaceId: workspaceId._id });
  });

  const result = await t.query(
    internal.sessions.getSessionVisibilityForStudentOwner,
    { sessionId: sessionId as any, recipientUserId: studentUserId }
  );
  expect(result.visible).toBe(true);
  expect(result.reason).toBe("ok");
  expect(result.workspaceId).toBeDefined();
});

test("getSessionVisibilityForStudentOwner: no_workspace when no workspace evidence exists", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);
  // No workspace row → resolveSessionWorkspace returns null.

  const result = await t.query(
    internal.sessions.getSessionVisibilityForStudentOwner,
    { sessionId: sessionId as any, recipientUserId: "user_student_rrn" }
  );
  expect(result.visible).toBe(false);
  expect(result.reason).toBe("no_workspace");
});

test("getSessionVisibilityForStudentOwner: not_owner when resolved workspace owner differs from recipient", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionId } = await seedInstructorAndSession(t);
  // Create a valid workspace for THIS session's pair, but query with
  // a different recipient user id (someone other than the workspace
  // owner). This exercises the `workspace.ownerId !== recipientUserId`
  // check — the visibility gate must reject notifying a user who
  // doesn't own the resolved workspace.
  await seedWorkspaceForPair(t, instructorId, "user_student_rrn");
  await t.run(async (ctx) => {
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_instructorId_ownerId", (q) =>
        q
          .eq("instructorId", instructorId as any)
          .eq("ownerId", "user_student_rrn")
      )
      .first();
    if (!ws) throw new Error("workspace missing in test");
    await ctx.db.patch(sessionId, { workspaceId: ws._id });
  });

  // The session's studentId is "user_student_rrn" and the workspace
  // owner matches — so the resolver returns the workspace. The
  // visibility gate then sees the recipient (`"user_someone_else"`)
  // is NOT the workspace owner and rejects with `not_owner`.
  const result = await t.query(
    internal.sessions.getSessionVisibilityForStudentOwner,
    { sessionId: sessionId as any, recipientUserId: "user_someone_else" }
  );
  expect(result.visible).toBe(false);
  expect(result.reason).toBe("not_owner");
});

test("getSessionVisibilityForStudentOwner: no_recording_artifact when session has no URL or status", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);
  // Clear the recording evidence.
  await t.run(async (ctx) => {
    await ctx.db.patch(sessionId, {
      recordingUrl: undefined,
      recordingTransferStatus: undefined,
      hasRecordingArtifact: undefined,
    });
  });

  const result = await t.query(
    internal.sessions.getSessionVisibilityForStudentOwner,
    { sessionId: sessionId as any, recipientUserId: "user_student_rrn" }
  );
  expect(result.visible).toBe(false);
  expect(result.reason).toBe("no_recording_artifact");
});

test("getSessionVisibilityForStudentOwner: recording_not_ready when status is uploading/failed/purged", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);
  for (const status of ["uploading", "failed", "purged"] as const) {
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { recordingTransferStatus: status });
    });
    const result = await t.query(
      internal.sessions.getSessionVisibilityForStudentOwner,
      { sessionId: sessionId as any, recipientUserId: "user_student_rrn" }
    );
    expect(result.visible).toBe(false);
    expect(result.reason).toBe("recording_not_ready");
  }
});

test("getSessionVisibilityForStudentOwner: no_recording_artifact when session is soft-deleted", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(sessionId, { deletedAt: Date.now() });
  });

  const result = await t.query(
    internal.sessions.getSessionVisibilityForStudentOwner,
    { sessionId: sessionId as any, recipientUserId: "user_student_rrn" }
  );
  expect(result.visible).toBe(false);
  expect(result.reason).toBe("no_recording_artifact");
});

test("recordingReadyNotifications enqueuePendingVisibility: idempotent on (sessionId, recipientUserId)", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);

  const first = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );
  expect(first.created).toBe(true);

  const second = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );
  expect(second.created).toBe(false);
  expect(second.notificationId).toBe(first.notificationId);
});

test("recordingReadyNotifications markReadyToSend: pending_visibility → ready_to_send", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionId } = await seedInstructorAndSession(t);
  const workspaceId = await seedWorkspaceForPair(
    t,
    instructorId,
    "user_student_rrn"
  );

  const enqueue = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );

  await t.mutation(
    internal.recordingReadyNotifications.markReadyToSend,
    {
      notificationId: enqueue.notificationId,
      workspaceId: workspaceId as any,
    }
  );

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("ready_to_send");
  expect(row?.workspaceId).toBe(workspaceId);
});

test("recordingReadyNotifications markReadyToSend: rejects from terminal states", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionId } = await seedInstructorAndSession(t);
  const workspaceId = await seedWorkspaceForPair(
    t,
    instructorId,
    "user_student_rrn"
  );

  const enqueue = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );
  // Mark sent first, then attempt to flip back to ready_to_send.
  await t.mutation(
    internal.recordingReadyNotifications.markReadyToSend,
    {
      notificationId: enqueue.notificationId,
      workspaceId: workspaceId as any,
    }
  );
  await t.mutation(internal.recordingReadyNotifications.markSent, {
    notificationId: enqueue.notificationId,
    providerEmailId: "resend_test_1",
  });

  await expect(
    t.mutation(internal.recordingReadyNotifications.markReadyToSend, {
      notificationId: enqueue.notificationId,
      workspaceId: workspaceId as any,
    })
  ).rejects.toThrow(/INVALID_STATE_TRANSITION/);
});

test("recordingReadyNotifications markFailed: pending_visibility → failed", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);

  const enqueue = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );

  await t.mutation(internal.recordingReadyNotifications.markFailed, {
    notificationId: enqueue.notificationId,
    deliveryError: "visibility-gate:no_workspace",
  });

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("failed");
  expect(row?.deliveryError).toBe("visibility-gate:no_workspace");
});

test("recordingReadyNotifications markFailed: idempotent on terminal states", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedInstructorAndSession(t);

  const enqueue = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );
  await t.mutation(internal.recordingReadyNotifications.markFailed, {
    notificationId: enqueue.notificationId,
    deliveryError: "first",
  });

  // Second call should be a no-op (does not throw, does not patch).
  await t.mutation(internal.recordingReadyNotifications.markFailed, {
    notificationId: enqueue.notificationId,
    deliveryError: "second",
  });

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("failed");
  expect(row?.deliveryError).toBe("first");
});

test("recordingReadyNotifications: full state-machine path", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionId } = await seedInstructorAndSession(t);
  const workspaceId = await seedWorkspaceForPair(
    t,
    instructorId,
    "user_student_rrn"
  );

  const enqueue = await t.mutation(
    internal.recordingReadyNotifications.enqueuePendingVisibility,
    {
      sessionId: sessionId as any,
      recipientUserId: "user_student_rrn",
    }
  );
  await t.mutation(
    internal.recordingReadyNotifications.markReadyToSend,
    {
      notificationId: enqueue.notificationId,
      workspaceId: workspaceId as any,
    }
  );
  await t.mutation(internal.recordingReadyNotifications.markSent, {
    notificationId: enqueue.notificationId,
    providerEmailId: "resend_test_full",
  });

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("sent");
  expect(row?.sentAt).toBeDefined();
  expect(row?.providerEmailId).toBe("resend_test_full");
  expect(row?.workspaceId).toBe(workspaceId);
});

/**
 * Tests for the Greptile R1 P2 fix on `chainNotifyRecordingReady`:
 * the Trigger.dev fetch must retry on 5xx, mark the row `failed`
 * with a `deliveryError` annotation after the retry budget is
 * exhausted, and re-throw so the call site sees the failure.
 *
 * Mirrors the fetch-mock pattern from `dailyEmailMetrics.test.ts`.
 */

beforeEach(() => {
  process.env.TRIGGER_SECRET_KEY = "tr_test_secret_key_for_convex_test";
  process.env.TRIGGER_API_KEY = undefined as unknown as string;
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.TRIGGER_SECRET_KEY;
  delete process.env.TRIGGER_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function seedFixtureForAction(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_rrn_action",
      email: "instructor-rrn-action@example.com",
      name: "Test Instructor",
      slug: "test-instructor-rrn-action",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_rrn_action",
      scheduledAt: Date.now() - 5_000,
      status: "completed",
      recordingConsent: true,
      callStartedAt: Date.now() - 5_000,
      recordingTransferStatus: "ready",
      recordingUrl: "recordings/test/rec.mp4",
      hasRecordingArtifact: true,
    });
    return { instructorId, sessionId, studentUserId: "user_student_rrn_action" };
  });
}

test("chainNotifyRecordingReady: happy path — single Trigger fetch + row inserted", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: "run_abc123" }));

  const t = convexTest(schema, modules);
  const { sessionId, studentUserId } = await seedFixtureForAction(t);

  const result = await t.action(
    internal.recordingReadyNotifications.chainNotifyRecordingReady,
    {
      sessionId: sessionId as any,
      recipientUserId: studentUserId,
    }
  );

  expect(result.triggerRunId).toBe("run_abc123");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
  expect(calledUrl).toContain("/tasks/notify-recording-ready/trigger");

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("recordingReadyNotifications").collect();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.deliveryStatus).toBe("pending_visibility");
});

test("chainNotifyRecordingReady: retries on 5xx then succeeds", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock
    .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
    .mockResolvedValueOnce(new Response("upstream down", { status: 502 }))
    .mockResolvedValueOnce(jsonResponse({ id: "run_after_retry" }));

  const t = convexTest(schema, modules);
  const { sessionId, studentUserId } = await seedFixtureForAction(t);

  const result = await t.action(
    internal.recordingReadyNotifications.chainNotifyRecordingReady,
    {
      sessionId: sessionId as any,
      recipientUserId: studentUserId,
    }
  );

  expect(result.triggerRunId).toBe("run_after_retry");
  expect(fetchMock).toHaveBeenCalledTimes(3);
}, 30_000);

test("chainNotifyRecordingReady: marks row failed and rethrows after exhausting retries", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue(
    new Response("upstream down", { status: 503 })
  );

  const t = convexTest(schema, modules);
  const { sessionId, studentUserId } = await seedFixtureForAction(t);

  await expect(
    t.action(
      internal.recordingReadyNotifications.chainNotifyRecordingReady,
      {
        sessionId: sessionId as any,
        recipientUserId: studentUserId,
      }
    )
  ).rejects.toThrow(/after 4 attempts/);

  // 4 attempts × all 503. The retry budget is MAX_TRIGGER_FETCH_ATTEMPTS.
  expect(fetchMock).toHaveBeenCalledTimes(4);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("recordingReadyNotifications").collect();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.deliveryStatus).toBe("failed");
  expect(rows[0]?.deliveryError).toMatch(/^trigger-fetch-exhausted:/);
}, 30_000);

test("chainNotifyRecordingReady: 4xx is permanent (no retry) and marks row failed", async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce(
    new Response("bad request: missing payload", { status: 400 })
  );

  const t = convexTest(schema, modules);
  const { sessionId, studentUserId } = await seedFixtureForAction(t);

  await expect(
    t.action(
      internal.recordingReadyNotifications.chainNotifyRecordingReady,
      {
        sessionId: sessionId as any,
        recipientUserId: studentUserId,
      }
    )
  ).rejects.toThrow(/rejected with 400/);

  // Greptile R1 P2: 4xx is a permanent error — single attempt.
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("recordingReadyNotifications").collect();
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.deliveryStatus).toBe("failed");
});
