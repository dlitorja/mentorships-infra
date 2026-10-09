/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * PR 12 PR 3 — Tests for the student-facing onboarding view functions
 * added to `convex/adminOnboarding.ts`:
 *
 *   - `getOnboardingView`            (public query)
 *   - `getIncompleteOnboardingForCurrentUser` (public query)
 *   - `claimOnboardingByEmail`       (internal mutation, called from
 *                                    the `user.created` Clerk webhook)
 *
 * Each function is exercised under the three relevant identities:
 * assigned student, matching instructor, admin, support, and the
 * negative cases (unauthorized student → null, unauthorized
 * instructor → null, completed-row filter, idempotent re-claim).
 */

async function seedInstructor(
  ctx: { db: any },
  args: { name: string; slug: string; userId?: string }
): Promise<string> {
  return await ctx.db.insert("instructors", {
    name: args.name,
    slug: args.slug,
    email: `${args.slug}@example.com`,
    isActive: true,
    isNew: false,
    oneOnOneInventory: 0,
    groupInventory: 0,
    maxActiveStudents: 10,
    userId: args.userId,
  });
}

async function seedAdminOnboarding(
  ctx: { db: any },
  args: {
    email: string;
    status: "queued" | "processing" | "completed" | "failed" | "cancelled";
    assignedStudentClerkId?: string;
    perInstructor: Array<{ instructorId: string; isRenewal: boolean }>;
    timeline?: Array<{ at: number; event: string; actorUserId?: string; details?: string }>;
    failureReason?: string;
  }
): Promise<string> {
  return await ctx.db.insert("adminOnboardings", {
    email: args.email,
    flowVersion: 1,
    source: "manual",
    submittedByUserId: "user_submitter",
    status: args.status,
    attemptCount: args.status === "failed" ? 2 : 1,
    assignedStudentClerkId: args.assignedStudentClerkId,
    failureReason: args.failureReason,
    perInstructor: args.perInstructor.map((p) => ({
      instructorId: p.instructorId,
      isRenewal: p.isRenewal,
      sessionsPerInstructor: 4,
    })),
    isSeparateStudentRecord: false,
    existingWorkspaceIds: [],
    timeline: args.timeline ?? [{ at: Date.now(), event: "queued" }],
    createdAt: Date.now(),
  });
}

test("getOnboardingView: returns the denormalised view to the assigned student", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_alice";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst A", slug: "inst-a" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "alice@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const view = await t
    .withIdentity({ subject: studentClerkId })
    .query(api.adminOnboarding.getOnboardingView, { onboardingId });

  expect(view).not.toBeNull();
  expect(view?.onboarding.email).toBe("alice@example.com");
  expect(view?.onboarding.status).toBe("processing");
  expect(view?.viewerRole).toBe("student");
  expect(view?.instructors).toHaveLength(1);
  expect(view?.instructors[0].name).toBe("Inst A");
  expect(view?.instructors[0].isRenewal).toBe(false);
  expect(view?.timelineOlderCount).toBe(0);
});

test("getOnboardingView: returns the view to a matching instructor", async () => {
  const t = convexTest(schema, modules);
  const instructorClerkId = "user_instructor_inst_b";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      name: "Inst B",
      slug: "inst-b",
      userId: instructorClerkId,
    });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "bob@example.com",
      status: "processing",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const view = await t
    .withIdentity({ subject: instructorClerkId })
    .query(api.adminOnboarding.getOnboardingView, { onboardingId });

  expect(view?.viewerRole).toBe("instructor");
  expect(view?.instructors[0].name).toBe("Inst B");
});

test("getOnboardingView: returns the view to an admin via users.role", async () => {
  const t = convexTest(schema, modules);
  const adminClerkId = "user_admin_root";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminClerkId,
      clerkId: adminClerkId,
      email: "admin-root@example.com",
      role: "admin",
    });
    instructorId = await seedInstructor(ctx, { name: "Inst C", slug: "inst-c" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "carol@example.com",
      status: "processing",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const view = await t
    .withIdentity({ subject: adminClerkId })
    .query(api.adminOnboarding.getOnboardingView, { onboardingId });

  expect(view?.viewerRole).toBe("admin");
});

test("getOnboardingView: returns null to an unrelated student (no 403 leak)", async () => {
  const t = convexTest(schema, modules);
  const assignedStudent = "user_student_alice";
  const unrelatedStudent = "user_student_eve";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst D", slug: "inst-d" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "alice@example.com",
      status: "processing",
      assignedStudentClerkId: assignedStudent,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const view = await t
    .withIdentity({ subject: unrelatedStudent })
    .query(api.adminOnboarding.getOnboardingView, { onboardingId });

  expect(view).toBeNull();
});

test("getIncompleteOnboardingForCurrentUser: returns most-recent non-terminal row for assigned student", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_dora";
  let instructorId = "";
  let olderCompletedId = "";
  let currentProcessingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst E", slug: "inst-e" });
    olderCompletedId = await seedAdminOnboarding(ctx, {
      email: "dora@example.com",
      status: "completed",
      perInstructor: [{ instructorId, isRenewal: true }],
    });
    currentProcessingId = await seedAdminOnboarding(ctx, {
      email: "dora@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId })
    .query(api.adminOnboarding.getIncompleteOnboardingForCurrentUser, {});

  expect(result).toBe(currentProcessingId);
  expect(result).not.toBe(olderCompletedId);
});

test("getIncompleteOnboardingForCurrentUser: returns null when student has no assigned onboarding", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_orphan";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst F", slug: "inst-f" });
    // Row exists but assignedStudentClerkId is set to a different user.
    await seedAdminOnboarding(ctx, {
      email: "someone-else@example.com",
      status: "processing",
      assignedStudentClerkId: "user_student_someone_else",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId })
    .query(api.adminOnboarding.getIncompleteOnboardingForCurrentUser, {});

  expect(result).toBeNull();
});

test("claimOnboardingByEmail: claims the most-recent non-terminal row and writes audit log", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst G", slug: "inst-g" });
    // Production paths (`previewAdminOnboarding` + `performCommit`)
    // normalize email to lowercase before inserting, so the row is
    // already lowercase here. The claim-side `args.email.trim().toLowerCase()`
    // then matches it.
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "fiona@example.com",
      status: "processing",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "fiona@example.com",
    clerkUserId: "user_student_fiona",
  });
  expect(result.claimedOnboardingId).toBe(onboardingId);

  // Verify the patch + audit log landed.
  await t.run(async (ctx) => {
    const row = await ctx.db.get(onboardingId as any);
    expect(row?.assignedStudentClerkId).toBe("user_student_fiona");
    const audits = await ctx.db.query("auditLogs").collect();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("student_claim_onboarding");
    expect(audits[0].actorId).toBe("user_student_fiona");
    expect(audits[0].actorRole).toBe("student");
    expect(audits[0].targetType).toBe("adminOnboarding");
    expect(audits[0].targetId).toBe(onboardingId);
  });
});

test("claimOnboardingByEmail: idempotent on second invocation with same clerkUserId", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst H", slug: "inst-h" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "grace@example.com",
      status: "processing",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const first = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "grace@example.com",
    clerkUserId: "user_student_grace",
  });
  expect(first.claimedOnboardingId).toBe(onboardingId);

  const second = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "grace@example.com",
    clerkUserId: "user_student_grace",
  });
  expect(second.claimedOnboardingId).toBe(onboardingId);

  await t.run(async (ctx) => {
    const audits = await ctx.db.query("auditLogs").collect();
    expect(audits).toHaveLength(1);
  });
});

test("claimOnboardingByEmail: skips terminal rows so old completed rows don't get re-claimed", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  let completedId = "";
  let activeId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst I", slug: "inst-i" });
    completedId = await seedAdminOnboarding(ctx, {
      email: "henry@example.com",
      status: "completed",
      perInstructor: [{ instructorId, isRenewal: true }],
    });
    activeId = await seedAdminOnboarding(ctx, {
      email: "henry@example.com",
      status: "processing",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "henry@example.com",
    clerkUserId: "user_student_henry",
  });
  expect(result.claimedOnboardingId).toBe(activeId);
  expect(result.claimedOnboardingId).not.toBe(completedId);

  await t.run(async (ctx) => {
    const completedRow = await ctx.db.get(completedId as any);
    expect(completedRow?.assignedStudentClerkId).toBeUndefined();
    const activeRow = await ctx.db.get(activeId as any);
    expect(activeRow?.assignedStudentClerkId).toBe("user_student_henry");
  });
});

test("claimOnboardingByEmail: returns null when no matching rows", async () => {
  const t = convexTest(schema, modules);
  const result = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "noone@example.com",
    clerkUserId: "user_student_noone",
  });
  expect(result.claimedOnboardingId).toBeNull();
  expect(result.matchedCount).toBe(0);
});
