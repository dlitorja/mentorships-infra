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

test("getIncompleteOnboardingForCurrentUser: returns completed row too (worker can complete before signup)", async () => {
  // Greptile P1 finding: with the old filter that excluded completed
  // rows, a student whose onboarding completes before they sign up
  // (e.g. a returning student with a prebuilt workspace) was routed to
  // /dashboard instead of the post-completion status page. The new
  // filter only skips cancelled rows.
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_kim";
  let completedId = "";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst L", slug: "inst-l" });
    completedId = await seedAdminOnboarding(ctx, {
      email: "kim@example.com",
      status: "completed",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId })
    .query(api.adminOnboarding.getIncompleteOnboardingForCurrentUser, {});

  expect(result).toBe(completedId);
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

test("claimOnboardingByEmail: prefers non-terminal row over completed row when both match", async () => {
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

test("claimOnboardingByEmail: claims completed row when worker outruns signup (no non-terminal row exists)", async () => {
  // Greptile P1 finding: the worker can complete provisioning before
  // the student signs up. With only completed rows on file, the claim
  // must still succeed so the student sees the post-completion status
  // page instead of being routed to /dashboard.
  const t = convexTest(schema, modules);
  let instructorId = "";
  let completedId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst J", slug: "inst-j" });
    completedId = await seedAdminOnboarding(ctx, {
      email: "irene@example.com",
      status: "completed",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "irene@example.com",
    clerkUserId: "user_student_irene",
  });
  expect(result.claimedOnboardingId).toBe(completedId);
  expect(result.skippedCompletedCount).toBe(1);

  await t.run(async (ctx) => {
    const row = await ctx.db.get(completedId as any);
    expect(row?.assignedStudentClerkId).toBe("user_student_irene");
  });
});

test("claimOnboardingByEmail: skips cancelled rows but still claims completed ones", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  let cancelledId = "";
  let completedId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst K", slug: "inst-k" });
    cancelledId = await seedAdminOnboarding(ctx, {
      email: "jack@example.com",
      status: "cancelled",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
    completedId = await seedAdminOnboarding(ctx, {
      email: "jack@example.com",
      status: "completed",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t.mutation(internal.adminOnboarding.claimOnboardingByEmail, {
    email: "jack@example.com",
    clerkUserId: "user_student_jack",
  });
  expect(result.claimedOnboardingId).toBe(completedId);
  expect(result.claimedOnboardingId).not.toBe(cancelledId);

  await t.run(async (ctx) => {
    const cancelledRow = await ctx.db.get(cancelledId as any);
    expect(cancelledRow?.assignedStudentClerkId).toBeUndefined();
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

/**
 * HUC-92 — Tests for the public wrapper
 * `claimOnboardingByEmailForCurrentUser` that the page server
 * component calls when `getOnboardingView` returns `null` for an
 * authenticated student. The wrapper exists so the student
 * doesn't eat a 404 when the Clerk `user.created` webhook is
 * still in flight.
 */

test("claimOnboardingByEmailForCurrentUser: signed-in student with matching email claims an unassigned row", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_alice_huc92";
  const studentEmail = "alice-huc92@example.com";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst A", slug: "inst-a-huc92" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: studentEmail,
      status: "queued",
      assignedStudentClerkId: undefined,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  // Pre-claim: the row exists but the student isn't assigned,
  // so the auth gate returns null.
  const viewBefore = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .query(api.adminOnboarding.getOnboardingView, { onboardingId });
  expect(viewBefore).toBeNull();

  const claim = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});

  expect(claim.claimedOnboardingId).toBe(onboardingId);
  expect(claim.matchedCount).toBe(1);
  expect(claim.skippedCompletedCount).toBe(0);

  // Post-claim: the row is now assigned to the student, so the
  // view is visible.
  const viewAfter = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .query(api.adminOnboarding.getOnboardingView, { onboardingId });
  expect(viewAfter).not.toBeNull();
  expect(viewAfter?.viewerRole).toBe("student");
  expect(viewAfter?.onboarding.assignedStudentClerkId).toBe(studentClerkId);
});

test("claimOnboardingByEmailForCurrentUser: hostile caller with a different email cannot claim the row", async () => {
  const t = convexTest(schema, modules);
  const bobClerkId = "user_student_bob_huc92";
  const bobEmail = "bob-huc92@example.com";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst A", slug: "inst-a-huc92b" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "alice-huc92@example.com",
      status: "queued",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  // Bob's JWT carries Bob's email. He calls the public wrapper;
  // email won't match Alice's row.
  const claim = await t
    .withIdentity({ subject: bobClerkId, email: bobEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});

  expect(claim.claimedOnboardingId).toBeNull();
  expect(claim.matchedCount).toBe(0);

  // The original Alice row stays unassigned — defense in depth:
  // a malicious signed-in user cannot charge a row to themselves.
  await t.run(async (ctx) => {
    const row = await ctx.db.get(onboardingId as any);
    expect(row?.assignedStudentClerkId).toBeUndefined();
  });
});

test("claimOnboardingByEmailForCurrentUser: idempotent on second call from the same identity", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_alice_huc92c";
  const studentEmail = "alice-huc92c@example.com";
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst A", slug: "inst-a-huc92c" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: studentEmail,
      status: "queued",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const first = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});
  expect(first.claimedOnboardingId).toBe(onboardingId);

  const second = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});
  expect(second.claimedOnboardingId).toBe(onboardingId);
  expect(second.matchedCount).toBe(first.matchedCount);
  expect(second.skippedCompletedCount).toBe(first.skippedCompletedCount);
});

test("claimOnboardingByEmailForCurrentUser: identity without email claim returns nulls without throwing", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst A", slug: "inst-a-huc92d" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "alice-huc92d@example.com",
      status: "queued",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  // JWT has `subject` but no `email` (defensive path for a custom
  // Clerk JWT template that omits email).
  const claim = await t
    .withIdentity({ subject: "user_student_no_email_huc92" })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});

  expect(claim.claimedOnboardingId).toBeNull();
  expect(claim.matchedCount).toBe(0);
  expect(claim.skippedCompletedCount).toBe(0);

  await t.run(async (ctx) => {
    const row = await ctx.db.get(onboardingId as any);
    expect(row?.assignedStudentClerkId).toBeUndefined();
  });
});

test("claimOnboardingByEmailForCurrentUser: P1 guard refuses to overwrite a row assigned to a different Clerk account", async () => {
  const t = convexTest(schema, modules);
  const aliceClerkId = "user_student_alice_huc92p1";
  const bobClerkId = "user_student_bob_huc92p1";
  const sharedEmail = "shared-huc92p1@example.com";

  let instructorId = "";
  let onboardingId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { name: "Inst P1", slug: "inst-huc92p1" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: sharedEmail,
      status: "queued",
      assignedStudentClerkId: aliceClerkId, // pre-existing Alice claim
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  // Bob's signed-in session carries the same email as Alice's row.
  // The P1 guard must refuse to overwrite Alice's assignment.
  const bobClaim = await t
    .withIdentity({ subject: bobClerkId, email: sharedEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});
  expect(bobClaim.claimedOnboardingId).toBeNull();
  expect(bobClaim.matchedCount).toBeGreaterThan(0);

  // Alice keeps her assignment — Bob can't kick her out.
  await t.run(async (ctx) => {
    const row = await ctx.db.get(onboardingId as any);
    expect(row?.assignedStudentClerkId).toBe(aliceClerkId);
  });

  // Sanity: Alice (the legitimate owner) re-running the same-call
  // still no-ops via the same-account short-circuit.
  const aliceClaim = await t
    .withIdentity({ subject: aliceClerkId, email: sharedEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});
  expect(aliceClaim.claimedOnboardingId).toBe(onboardingId);
});

/**
 * PR 12 PR E (Follow-up) — Tests for the in-app onboarding gate
 * query `getStudentOnboardingGateForCurrentUser`. This is the
 * runtime check that the proxy.ts middleware, the ProtectedLayout
 * banner, and the dashboard welcome card all consume to decide
 * whether a student should be redirected to /onboarding/[id]
 * before using the rest of the app.
 */

/**
 * Insert a `seedOnboardingQuestionnaireSubmission` helper that the
 * gate tests need, kept in the same file to mirror the
 * `seedAdminOnboarding` pattern.
 */
async function seedSubmission(
  ctx: { db: any },
  args: {
    onboardingId: string;
    studentClerkId: string;
    status: "draft" | "submitted";
  },
): Promise<void> {
  await ctx.db.insert("onboardingQuestionnaireSubmissions", {
    onboardingId: args.onboardingId,
    studentClerkId: args.studentClerkId,
    questionnaireVersion: 1,
    status: args.status,
    answers: [],
    inspirations: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    submittedAt: args.status === "submitted" ? Date.now() : undefined,
  });
}

test("getStudentOnboardingGateForCurrentUser: anonymous caller is not gated", async () => {
  const t = convexTest(schema, modules);
  const result = await t
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});
  expect(result.requiresOnboardingCompletion).toBe(false);
  expect(result.onboardingId).toBeNull();
  expect(result.reason).toBeNull();
});

test("getStudentOnboardingGateForCurrentUser: student with no assigned row is not gated", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate A", slug: "inst-gate-a" });
    // Row exists but is assigned to a different student.
    await seedAdminOnboarding(ctx, {
      email: "gate-other@example.com",
      status: "queued",
      assignedStudentClerkId: "user_someone_else",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: "user_student_gate_no_row", email: "gate-self@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(false);
  expect(result.onboardingId).toBeNull();
});

test("getStudentOnboardingGateForCurrentUser: assigned row with no submission is gated (processing)", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_no_sub";
  let onboardingId = "";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate B", slug: "inst-gate-b" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "gate-b@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-b@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(true);
  expect(result.onboardingId).toBe(onboardingId);
  expect(result.rowStatus).toBe("processing");
  expect(result.questionnaireSubmitted).toBe(false);
  expect(result.reason).toMatch(/preparing your workspaces/i);
});

test("getStudentOnboardingGateForCurrentUser: assigned row with draft-only submission is gated", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_draft";
  let onboardingId = "";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate C", slug: "inst-gate-c" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "gate-c@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
    await seedSubmission(ctx, {
      onboardingId,
      studentClerkId,
      status: "draft",
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-c@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(true);
  expect(result.onboardingId).toBe(onboardingId);
  expect(result.questionnaireSubmitted).toBe(false);
});

test("getStudentOnboardingGateForCurrentUser: assigned row with submitted questionnaire is not gated", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_submitted";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate D", slug: "inst-gate-d" });
    const onboardingId = await seedAdminOnboarding(ctx, {
      email: "gate-d@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
    await seedSubmission(ctx, {
      onboardingId,
      studentClerkId,
      status: "submitted",
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-d@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(false);
  expect(result.onboardingId).toBeNull();
});

test("getStudentOnboardingGateForCurrentUser: failed row reports the failed-proof reason and is still gated", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_failed";
  let onboardingId = "";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate E", slug: "inst-gate-e" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: "gate-e@example.com",
      status: "failed",
      assignedStudentClerkId: studentClerkId,
      failureReason: "Resend API returned 500 on student welcome email",
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-e@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(true);
  expect(result.onboardingId).toBe(onboardingId);
  expect(result.rowStatus).toBe("failed");
  expect(result.reason).toMatch(/administrator will retry/i);
});

test("getStudentOnboardingGateForCurrentUser: cancelled row falls through the gate", async () => {
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_cancelled";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate F", slug: "inst-gate-f" });
    await seedAdminOnboarding(ctx, {
      email: "gate-f@example.com",
      status: "cancelled",
      assignedStudentClerkId: studentClerkId,
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-f@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(false);
  expect(result.onboardingId).toBeNull();
});

test("getStudentOnboardingGateForCurrentUser: caller-side self-heal claim → gate routes the freshly-signed-up student", async () => {
  // Greptile round-2 lesson: the gate query itself is READ-ONLY
  // (Convex queries can't run mutations). The caller MUST invoke
  // the public `claimOnboardingByEmailForCurrentUser` mutation
  // FIRST so a freshly-signed-up student whose `user.created`
  // webhook hasn't reached Convex yet still gets matched to their
  // row. This mirrors the proxy.ts middleware / ProtectedLayout
  // server-side claim-then-fetch contract.
  //
  // Without the prior claim step, the gate is `false` (silently
  // falls through) — the student's row exists but
  // `assignedStudentClerkId` is `undefined`, so the
  // `by_assignedStudentClerkId_createdAt` index returns zero rows.
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_self_heal";
  const studentEmail = "gate-self-heal@example.com";
  let onboardingId = "";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate G", slug: "inst-gate-g" });
    onboardingId = await seedAdminOnboarding(ctx, {
      email: studentEmail,
      status: "queued",
      assignedStudentClerkId: undefined, // unassigned, simulating pre-webhook state
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  // Step 1: gate WITHOUT prior claim returns false — confirms the
  // contract that callers cannot rely on the gate to self-heal.
  const gateBeforeClaim = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});
  expect(gateBeforeClaim.requiresOnboardingCompletion).toBe(false);

  // Step 2: caller fires the mutation (mirrors proxy.ts and
  // ProtectedLayout).
  await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .mutation(api.adminOnboarding.claimOnboardingByEmailForCurrentUser, {});

  // Step 3: gate trip — row is now claimed and questionnaire is not
  // yet submitted.
  const result = await t
    .withIdentity({ subject: studentClerkId, email: studentEmail })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(true);
  expect(result.onboardingId).toBe(onboardingId);
  expect(result.rowStatus).toBe("queued");
  expect(result.questionnaireSubmitted).toBe(false);
  expect(result.reason).toMatch(/preparing your workspaces/i);

  // Side-effect: the underlying row is now claimed, evidence visible
  // to support tooling.
  await t.run(async (ctx) => {
    const row = await ctx.db.get(onboardingId as any);
    expect(row?.assignedStudentClerkId).toBe(studentClerkId);
  });
});

test("getStudentOnboardingGateForCurrentUser: historical completed row falls through once the active row has a submission", async () => {
  // Mirror of the Greptile P1 finding on `getIncompleteOnboardingForCurrentUser`:
  // a returning student can have multiple historical rows, the most
  // recent may be `completed`, but a follow-up admin onboarding has
  // been emitted with `processing` and no submission yet. The gate
  // must trip on the FRESH row, not the historical completed one.
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_history";
  let activeId = "";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate H", slug: "inst-gate-h" });
    await seedAdminOnboarding(ctx, {
      email: "gate-h@example.com",
      status: "completed",
      assignedStudentClerkId: studentClerkId,
      createdAt: Date.now() - 1_000_000,
      perInstructor: [{ instructorId, isRenewal: true }],
    });
    activeId = await seedAdminOnboarding(ctx, {
      email: "gate-h@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      createdAt: Date.now(),
      perInstructor: [{ instructorId, isRenewal: false }],
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-h@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  expect(result.requiresOnboardingCompletion).toBe(true);
  expect(result.onboardingId).toBe(activeId);
  expect(result.rowStatus).toBe("processing");
});

test("getStudentOnboardingGateForCurrentUser: newest submitted row clears the gate even when older rows are incomplete", async () => {
  // Greptile P1 follow-up: a returning student may have multiple
  // `adminOnboardings` rows assigned to them. The NEWEST non-cancelled
  // row's questionnaire submission is the single source of truth —
  // older rows are historical and should NOT re-block the student
  // after they've finished their current term. (Originally the
  // query iterated `.order("desc")` and tripped on the first
  // incomplete older row, which is wrong.)
  const t = convexTest(schema, modules);
  const studentClerkId = "user_student_gate_newest_submitted";
  await t.run(async (ctx) => {
    const instructorId = await seedInstructor(ctx, { name: "Inst Gate I", slug: "inst-gate-i" });
    // Older row: completed term, but questionnaire draft was never
    // submitted before the term rolled over.
    const historicalId = await seedAdminOnboarding(ctx, {
      email: "gate-i@example.com",
      status: "completed",
      assignedStudentClerkId: studentClerkId,
      createdAt: Date.now() - 2_000_000,
      perInstructor: [{ instructorId, isRenewal: true }],
    });
    await seedSubmission(ctx, {
      onboardingId: historicalId,
      studentClerkId,
      status: "draft", // never submitted for the historical term
    });
    // Newest row: fresh admin onboarding (this term), status
    // `processing`, and the questionnaire has been submitted.
    const newestId = await seedAdminOnboarding(ctx, {
      email: "gate-i@example.com",
      status: "processing",
      assignedStudentClerkId: studentClerkId,
      createdAt: Date.now(),
      perInstructor: [{ instructorId, isRenewal: false }],
    });
    await seedSubmission(ctx, {
      onboardingId: newestId,
      studentClerkId,
      status: "submitted",
    });
  });

  const result = await t
    .withIdentity({ subject: studentClerkId, email: "gate-i@example.com" })
    .query(api.adminOnboarding.getStudentOnboardingGateForCurrentUser, {});

  // Newest non-cancelled row's questionnaire is submitted → no gate,
  // even though the historical row still has a draft.
  expect(result.requiresOnboardingCompletion).toBe(false);
  expect(result.onboardingId).toBeNull();
  expect(result.questionnaireSubmitted).toBe(true);
});
