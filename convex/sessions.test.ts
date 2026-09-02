/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { resolveSessionWorkspace } from "./lib/sessionWorkspace";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedWorkspacePair(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_sessions",
      email: "instructor@example.com",
      name: "Test Instructor",
      slug: "test-instructor-sessions",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student_sessions",
      instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
    });
    const seatReservationId = await ctx.db.insert("seatReservations", {
      instructorId,
      userId: "user_student_sessions",
      sessionPackId,
      seatExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Current Workspace",
      ownerId: "user_student_sessions",
      instructorId,
      seatReservationId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    return { instructorId, sessionPackId, workspaceId };
  });
}

test("createSession persists the pack-backed workspace", async () => {
  const t = convexTest(schema, modules);
  const seeded = await seedWorkspacePair(t);
  const student = t.withIdentity({ subject: "user_student_sessions" });

  const sessionId = await student.mutation(api.sessions.createSession, {
    instructorId: seeded.instructorId,
    studentId: "user_student_sessions",
    sessionPackId: seeded.sessionPackId,
    scheduledAt: Date.now() + 60_000,
    recordingConsent: true,
  });
  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

  expect(session?.workspaceId).toBe(seeded.workspaceId);
  await expect(
    t.withIdentity({ subject: "user_unrelated" }).mutation(
      api.sessions.createSession,
      {
        instructorId: seeded.instructorId,
        studentId: "user_student_sessions",
        sessionPackId: seeded.sessionPackId,
        scheduledAt: Date.now() + 120_000,
      }
    )
  ).rejects.toThrow("Forbidden");
});

test("createSession supports one seatless workspace without counting admin workspaces", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedWorkspacePair(t);
  const { sessionPackId, workspaceId } = await t.run(async (ctx) => {
    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_seatless_student",
      instructorId,
      totalSessions: 1,
      remainingSessions: 1,
      purchasedAt: Date.now(),
      status: "active",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Seatless Workspace",
      ownerId: "user_seatless_student",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    await ctx.db.insert("workspaces", {
      name: "Admin Workspace",
      ownerId: "user_seatless_student",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_student",
    });
    return { sessionPackId, workspaceId };
  });

  const sessionId = await t
    .withIdentity({ subject: "user_seatless_student" })
    .mutation(api.sessions.createSession, {
      instructorId,
      studentId: "user_seatless_student",
      sessionPackId,
      scheduledAt: Date.now() + 60_000,
    });
  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.workspaceId).toBe(workspaceId);
});

test("recordings stay isolated to their workspace and remain readable after it ends", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedWorkspacePair(t);
  const { endedWorkspaceId, activeWorkspaceId, endedSessionId } = await t.run(
    async (ctx) => {
      const endedWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Ended Workspace",
        ownerId: "user_student_sessions",
        instructorId,
        isPublic: false,
        endedAt: Date.now() - 1000,
        studentImageCount: 0,
        instructorImageCount: 0,
        type: "mentorship",
      });
      const activeWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Replacement Workspace",
        ownerId: "user_student_sessions",
        instructorId,
        isPublic: false,
        studentImageCount: 0,
        instructorImageCount: 0,
        type: "mentorship",
      });
      const endedSessionId = await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student_sessions",
        workspaceId: endedWorkspaceId,
        scheduledAt: Date.now() - 10_000,
        status: "completed",
        recordingConsent: true,
        callStartedAt: Date.now() - 10_000,
        recordingUrl: "recordings/ended/session.mp4",
        recordingTransferStatus: "ready",
        hasRecordingArtifact: true,
      });
      await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student_sessions",
        workspaceId: activeWorkspaceId,
        scheduledAt: Date.now(),
        status: "completed",
        recordingConsent: true,
        callStartedAt: Date.now(),
        recordingUrl: "recordings/active/session.mp4",
        recordingTransferStatus: "ready",
        hasRecordingArtifact: true,
      });
      for (let index = 0; index < 60; index++) {
        await ctx.db.insert("sessions", {
          instructorId,
          studentId: "user_student_sessions",
          workspaceId: endedWorkspaceId,
          scheduledAt: Date.now() + index,
          status: "completed",
          recordingConsent: false,
        });
      }
      return { endedWorkspaceId, activeWorkspaceId, endedSessionId };
    }
  );
  const student = t.withIdentity({ subject: "user_student_sessions" });

  const endedRecordings = await student.query(
    api.sessions.getCallRecordingsForWorkspace,
    { workspaceId: endedWorkspaceId }
  );
  const activeRecordings = await student.query(
    api.sessions.getCallRecordingsForWorkspace,
    { workspaceId: activeWorkspaceId }
  );
  expect(endedRecordings.recordings.map((row) => row.sessionId)).toEqual([
    endedSessionId,
  ]);
  expect(activeRecordings.recordings).toHaveLength(1);

  const endedWorkspace = await student.query(
    api.workspaces.getWorkspaceByIdForUser,
    { id: endedWorkspaceId }
  );
  expect(endedWorkspace?._id).toBe(endedWorkspaceId);
  const playback = await student.query(
    api.workspaces.getSessionParticipantForRecording,
    { sessionId: endedSessionId }
  );
  expect(playback?.recordingS3Key).toBe("recordings/ended/session.mp4");

  await t.run(async (ctx) => {
    const unrelatedPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_unrelated",
      instructorId,
      totalSessions: 1,
      remainingSessions: 1,
      purchasedAt: Date.now(),
      status: "active",
    });
    await ctx.db.insert("seatReservations", {
      instructorId,
      userId: "user_unrelated",
      sessionPackId: unrelatedPackId,
      seatExpiresAt: Date.now() + 60_000,
      status: "active",
    });
  });
  const unrelatedAccess = await t
    .withIdentity({ subject: "user_unrelated" })
    .query(api.workspaces.getWorkspaceByIdForUser, { id: endedWorkspaceId });
  expect(unrelatedAccess).toBeNull();

  await t.run(async (ctx) => {
    await ctx.db.patch(endedWorkspaceId, { deletedAt: Date.now() });
  });
  expect(
    await student.query(api.sessions.getCallRecordingsForWorkspace, {
      workspaceId: endedWorkspaceId,
    })
  ).toEqual({ recordings: [], isTruncated: false });
  expect(
    await student.query(api.workspaces.getSessionParticipantForRecording, {
      sessionId: endedSessionId,
    })
  ).toBeNull();
});

test("legacy workspace resolution uses pack evidence and refuses an ambiguous pair", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionPackId, workspaceId } = await seedWorkspacePair(t);
  const resolved = await t.run(async (ctx) => {
    await ctx.db.insert("workspaces", {
      name: "Another Workspace",
      ownerId: "user_student_sessions",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    const ambiguousSessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_sessions",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
    });
    const packSessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_sessions",
      sessionPackId,
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
    });
    const ambiguousSession = await ctx.db.get(ambiguousSessionId);
    const packSession = await ctx.db.get(packSessionId);
    if (!ambiguousSession || !packSession) throw new Error("Session not found");
    return {
      ambiguous: await resolveSessionWorkspace(ctx, ambiguousSession),
      throughPack: await resolveSessionWorkspace(ctx, packSession),
    };
  });

  expect(resolved.ambiguous).toBeNull();
  expect(resolved.throughPack?._id).toBe(workspaceId);
});

test("recording query finds an unlinked legacy recording beyond 201 newer sessions", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, sessionPackId, workspaceId } = await seedWorkspacePair(t);
  const legacyRecordingId = await t.run(async (ctx) => {
    const legacyRecordingId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_sessions",
      sessionPackId,
      scheduledAt: Date.now() - 1_000_000,
      status: "completed",
      recordingConsent: true,
      recordingUrl: "recordings/legacy/session.mp4",
      // Simulates a session whose `recordingUrl` predates the workspace
      // recording fields and was just backfilled by
      // `backfillSessionWorkspaceLinks`. The dual-read still has to find
      // it among 220 newer non-recording sessions.
      hasRecordingArtifact: true,
    });
    for (let index = 0; index < 220; index++) {
      await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student_sessions",
        sessionPackId,
        scheduledAt: Date.now() + index,
        status: "completed",
        recordingConsent: false,
      });
    }
    return legacyRecordingId;
  });

  const result = await t
    .withIdentity({ subject: "user_student_sessions" })
    .query(api.sessions.getCallRecordingsForWorkspace, { workspaceId });
  expect(result.recordings.map((recording) => recording.sessionId)).toContain(
    legacyRecordingId
  );
});
