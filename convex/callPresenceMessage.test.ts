/// <reference types="vite/client" />
/**
 * Tests for `convex/workspaces.ts:prepareCallPresenceMessage` +
 * `recordCallPresenceMessage` (PR platform-call-bugs round 7).
 *
 * Covers:
 *   - P1+Security (forgery): the record mutation now requires a
 *     nonce minted by the prepare mutation. Calls without a
 *     valid nonce fail; replayed nonces fail; expired nonces
 *     fail; nonces presented by a different caller fail.
 *   - P1 (wrong-name): the actor lookup now anchors to the
 *     workspace's ownerId (student) or instructor's userId
 *     (instructor) before falling back to the auth subject.
 *   - System messages are still created with `type: "system"`
 *     and the resolved display name.
 */
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Seed a workspace owned by `studentUserId` with an instructor
 * mapped to `instructorUserId`, plus a `users` row for each so
 * the actor lookup can resolve a display name. Returns the
 * sessionId pointing at the workspace.
 */
async function seedCallPresenceFixture(
  t: ReturnType<typeof convexTest>,
  args: {
    studentUserId: string;
    studentFirstName?: string;
    instructorUserId: string;
    instructorFirstName?: string;
  }
): Promise<{ workspaceId: string; sessionId: string }> {
  let workspaceId = "";
  let sessionId = "";
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: args.instructorUserId,
    });
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: args.studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      instructorId: instructorId as any,
      type: "mentorship",
    });
    sessionId = await ctx.db.insert("sessions", {
      instructorId: instructorId as any,
      studentId: args.studentUserId,
      workspaceId: workspaceId as any,
      scheduledAt: Date.now(),
      status: "scheduled",
      recordingConsent: false,
    });
    // Greptile round 7 P1: the actor lookup prefers the
    // workspace-context row (workspace.ownerId for student,
    // instructor.userId for instructor). Seed both `users`
    // rows so the resolver has data to find.
    await ctx.db.insert("users", {
      userId: args.studentUserId,
      email: `${args.studentUserId}@example.com`,
      clerkId: args.studentUserId,
      firstName: args.studentFirstName ?? "Student",
      lastName: "Tester",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: args.instructorUserId,
      email: `${args.instructorUserId}@example.com`,
      clerkId: args.instructorUserId,
      firstName: args.instructorFirstName ?? "Instructor",
      lastName: "Tester",
      role: "instructor",
    });
  });
  return { workspaceId, sessionId };
}

afterEach(() => {
  vi.useRealTimers();
});

// PR platform-call-bugs round 7 P1+Security: a malicious caller
// cannot post a forged "joined" notice without first minting a
// nonce. Verify the bare-record path rejects when a NONCE WAS
// NEVER MINTED — the schema validator refuses the bogus id
// before the mutation runs. For the runtime-rejection case
// (a real id whose row doesn't match), see the "nonce presented
// by a different caller" test below.
test("callPresence: recordCallPresenceMessage refuses a bogus nonceId at the schema layer", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    instructorUserId: "user_instructor",
  });
  const asStudent = t.withIdentity({ subject: "user_student" });
  await expect(
    asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
      nonceId: "junk_nonce_id" as any,
    })
  ).rejects.toThrow(/Expected ID for table/i);
});

// PR platform-call-bugs round 7 P1+Security: a real caller
// mints a nonce via prepare, then records with it. The
// system message is created with the resolved display name.
test("callPresence: prepare + record happy path creates a system message", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    studentFirstName: "Alice",
    instructorUserId: "user_instructor",
    instructorFirstName: "Bob",
  });
  // Authenticate as the student.
  const asStudent = t.withIdentity({ subject: "user_student" });

  const nonceId = await asStudent.mutation(
    api.workspaces.prepareCallPresenceMessage,
    {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
    }
  );

  await asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
    workspaceId: workspaceId as any,
    sessionId: sessionId as any,
    kind: "joined",
    nonceId,
  });

  const messages = await t.run(async (ctx) => {
    return await ctx.db.query("workspaceMessages").collect();
  });
  expect(messages).toHaveLength(1);
  expect(messages[0].type).toBe("system");
  expect(messages[0].systemEventKind).toBe("joined");
  expect(messages[0].userId).toBe("user_student");
  // Round 7 P1 (wrong-name): the resolved name comes from the
  // workspace's ownerId (`Alice`), not from a client-supplied
  // arg.
  expect(messages[0].content).toBe("Alice Tester joined the call");
});

// PR platform-call-bugs round 7 P1+Security: a minted nonce
// cannot be replayed. The first record consumes it; the second
// record with the same nonce fails fast.
test("callPresence: nonce cannot be replayed", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    instructorUserId: "user_instructor",
  });
  const asStudent = t.withIdentity({ subject: "user_student" });

  const nonceId = await asStudent.mutation(
    api.workspaces.prepareCallPresenceMessage,
    {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
    }
  );

  await asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
    workspaceId: workspaceId as any,
    sessionId: sessionId as any,
    kind: "joined",
    nonceId,
  });

  await expect(
    asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
      nonceId,
    })
  ).rejects.toThrow(/already used/i);
});

// PR platform-call-bugs round 7 P1+Security: an expired nonce
// is rejected.
test("callPresence: expired nonce is rejected", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    instructorUserId: "user_instructor",
  });
  const asStudent = t.withIdentity({ subject: "user_student" });

  const nonceId = await asStudent.mutation(
    api.workspaces.prepareCallPresenceMessage,
    {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
    }
  );

  // Patch the stored `expiresAt` so we don't have to wait 30s.
  await t.run(async (ctx) => {
    await ctx.db.patch(nonceId, { expiresAt: Date.now() - 1 });
  });

  await expect(
    asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
      nonceId,
    })
  ).rejects.toThrow(/expired/i);
});

// PR platform-call-bugs round 7 P1+Security: a nonce minted by
// caller A cannot be presented by caller B.
test("callPresence: nonce presented by a different caller is rejected", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    instructorUserId: "user_instructor",
  });
  const asStudent = t.withIdentity({ subject: "user_student" });

  const nonceId = await asStudent.mutation(
    api.workspaces.prepareCallPresenceMessage,
    {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
    }
  );

  // Switch identity to a different user.
  const asStranger = t.withIdentity({ subject: "user_someone_else" });
  await expect(
    asStranger.mutation(api.workspaces.recordCallPresenceMessage, {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
      nonceId,
    })
  ).rejects.toThrow(/does not belong to caller/i);
});

// PR platform-call-bugs round 7 P1+Security: a nonce for kind
// "joined" cannot be used to post a "left" notice.
test("callPresence: nonce kind mismatch is rejected", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    instructorUserId: "user_instructor",
  });
  const asStudent = t.withIdentity({ subject: "user_student" });

  const nonceId = await asStudent.mutation(
    api.workspaces.prepareCallPresenceMessage,
    {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
    }
  );

  await expect(
    asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "left",
      nonceId,
    })
  ).rejects.toThrow(/kind mismatch/i);
});

// PR platform-call-bugs round 7 P1: the actor lookup uses the
// workspace's ownerId (student role). A second `users` row with
// a different firstName for the same Clerk id must NOT be
// preferred.
test("callPresence: student role resolves via workspace.ownerId, not by_clerkId order", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, sessionId } = await seedCallPresenceFixture(t, {
    studentUserId: "user_student",
    studentFirstName: "RealName",
    instructorUserId: "user_instructor",
  });
  // Add a second users row with a different firstName but the
  // same clerkId. The lookup must prefer the workspace-context
  // row (`RealName`) over the by_clerkId fallback.
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_stale",
      email: "stale@example.com",
      clerkId: "user_student",
      firstName: "StaleName",
      lastName: "Wrong",
      role: "student",
    });
  });
  const asStudent = t.withIdentity({ subject: "user_student" });

  const nonceId = await asStudent.mutation(
    api.workspaces.prepareCallPresenceMessage,
    {
      workspaceId: workspaceId as any,
      sessionId: sessionId as any,
      kind: "joined",
    }
  );
  await asStudent.mutation(api.workspaces.recordCallPresenceMessage, {
    workspaceId: workspaceId as any,
    sessionId: sessionId as any,
    kind: "joined",
    nonceId,
  });

  const messages = await t.run(async (ctx) => {
    return await ctx.db.query("workspaceMessages").collect();
  });
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toBe("RealName Tester joined the call");
});
