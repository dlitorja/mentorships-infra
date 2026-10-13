/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for `convex/studentInvitations.ts` admin-or-support gates
 * (PR-B / Issue 3). Pre-PR-B, `listStudentInvitations` /
 * `createStudentInvitation` / `updateStudentInvitationStatus` /
 * `updateStudentInvitationClerkId` only required an authenticated
 * identity, which leaked student email PII and let any signed-in user
 * mutate invitation rows. After PR-B they require `users.role` to be
 * `admin` or `support`, with the same `requireAdminOrSupport` shape
 * used in `convex/adminOnboarding.ts:152-163`.
 *
 * Tests pin:
 *   1. `listStudentInvitations` returns empty for unauthenticated and
 *      throws `Forbidden` for non-admin/support identities.
 *   2. `createStudentInvitation` rejects non-admin/support identities.
 *   3. `updateStudentInvitationStatus` rejects non-admin/support.
 *   4. `updateStudentInvitationClerkId` rejects non-admin/support.
 *   5. `resendStudentInvitation` accepts admin, refuses terminal
 *      statuses (accepted/cancelled), and updates the row's
 *      `clerkInvitationId`, `expiresAt`, and `status` to `pending`.
 *   6. `migrateInvitation` remains publicly callable (migration CLI
 *      contract — see the function's doc comment for the rationale).
 */

type UserRole =
  | "student"
  | "instructor"
  | "admin"
  | "video_editor"
  | "support";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides: {
    userId?: string;
    role?: UserRole;
  } = {}
): Promise<string> {
  return (await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      userId: overrides.userId ?? "user_seed",
      email: `${overrides.userId ?? "user_seed"}@example.com`,
      clerkId: `clerk_${overrides.userId ?? "user_seed"}`,
      role: overrides.role ?? "student",
    });
  })) as string;
}

async function seedInstructor(
  t: ReturnType<typeof convexTest>,
  slug: string
): Promise<string> {
  return (await t.run(async (ctx) => {
    return await ctx.db.insert("instructors", {
      name: `Instructor ${slug}`,
      slug,
      email: `${slug}@example.com`,
    });
  })) as string;
}

async function seedStudentInvitation(
  t: ReturnType<typeof convexTest>,
  args: {
    email: string;
    instructorId: string;
    status: "pending" | "accepted" | "expired" | "cancelled";
    clerkInvitationId?: string;
    expiresAt?: number;
  }
): Promise<string> {
  return (await t.run(async (ctx) => {
    return await ctx.db.insert("studentInvitations", {
      email: args.email.toLowerCase(),
      instructorId: args.instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
      clerkInvitationId: args.clerkInvitationId,
      expiresAt: args.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
      status: args.status,
    });
  })) as string;
}

// -------------------------------------------------------------------
// `listStudentInvitations` gate
// -------------------------------------------------------------------

test("listStudentInvitations: empty for unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "list-b-unauth");
  await seedStudentInvitation(t, {
    email: "alice@example.com",
    instructorId,
    status: "pending",
  });

  const result = await t.query(api.studentInvitations.listStudentInvitations, {
    status: "pending",
  });
  expect(result).toEqual({ items: [], total: 0 });
});

test("listStudentInvitations: throws Forbidden for non-admin/support", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "list-b-student");
  await seedStudentInvitation(t, {
    email: "bob@example.com",
    instructorId,
    status: "pending",
  });
  await seedUser(t, { userId: "user_student_b", role: "student" });

  await expect(
    t.withIdentity({ subject: "user_student_b" }).query(
      api.studentInvitations.listStudentInvitations,
      { status: "pending" }
    )
  ).rejects.toThrow("Forbidden");
});

test("listStudentInvitations: returns invite row for admin", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "list-b-admin");
  await seedStudentInvitation(t, {
    email: "carol@example.com",
    instructorId,
    status: "pending",
  });
  await seedUser(t, { userId: "user_admin_b", role: "admin" });

  const result = await t
    .withIdentity({ subject: "user_admin_b" })
    .query(api.studentInvitations.listStudentInvitations, {
      status: "pending",
    });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].email).toBe("carol@example.com");
});

// -------------------------------------------------------------------
// `createStudentInvitation` gate
// -------------------------------------------------------------------

test("createStudentInvitation: rejects non-admin/support", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "create-b-reject");
  await seedUser(t, { userId: "user_instructor_b", role: "instructor" });

  await expect(
    t.withIdentity({ subject: "user_instructor_b" }).mutation(
      api.studentInvitations.createStudentInvitation,
      {
        email: "dave@example.com",
        instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
    )
  ).rejects.toThrow("Forbidden");
});

test("createStudentInvitation: admin can mint, blocks duplicate-pending", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "create-b-admin");
  await seedUser(t, { userId: "user_admin_b2", role: "admin" });

  await t
    .withIdentity({ subject: "user_admin_b2" })
    .mutation(api.studentInvitations.createStudentInvitation, {
      email: "erin@example.com",
      instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

  // Duplicate pending refusal is part of the original dedup logic;
  // pinning it so PR-B's gate addition did not regress it.
  await expect(
    t.withIdentity({ subject: "user_admin_b2" }).mutation(
      api.studentInvitations.createStudentInvitation,
      {
        email: "erin@example.com",
        instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
    )
  ).rejects.toThrow("A pending invitation already exists");
});

// -------------------------------------------------------------------
// `updateStudentInvitationStatus` gate
// -------------------------------------------------------------------

test("updateStudentInvitationStatus: rejects non-admin/support", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "status-b-reject");
  const id = await seedStudentInvitation(t, {
    email: "frank@example.com",
    instructorId,
    status: "pending",
  });
  await seedUser(t, { userId: "user_student_b2", role: "student" });

  await expect(
    t.withIdentity({ subject: "user_student_b2" }).mutation(
      api.studentInvitations.updateStudentInvitationStatus,
      {
        id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        status: "cancelled",
      }
    )
  ).rejects.toThrow("Forbidden");
});

test("updateStudentInvitationStatus: admin can flip pending → cancelled", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "status-b-ok");
  const id = await seedStudentInvitation(t, {
    email: "gina@example.com",
    instructorId,
    status: "pending",
  });
  await seedUser(t, { userId: "user_admin_b3", role: "admin" });

  await t
    .withIdentity({ subject: "user_admin_b3" })
    .mutation(api.studentInvitations.updateStudentInvitationStatus, {
      id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      status: "cancelled",
    });

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("cancelled");
});

// -------------------------------------------------------------------
// `updateStudentInvitationClerkId` gate
// -------------------------------------------------------------------

test("updateStudentInvitationClerkId: rejects non-admin/support", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "clerk-b-reject");
  const id = await seedStudentInvitation(t, {
    email: "harry@example.com",
    instructorId,
    status: "pending",
  });
  await seedUser(t, { userId: "user_student_b3", role: "student" });

  await expect(
    t.withIdentity({ subject: "user_student_b3" }).mutation(
      api.studentInvitations.updateStudentInvitationClerkId,
      {
        invitationId: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        clerkInvitationId: "inv_replaced_by_attacker",
      }
    )
  ).rejects.toThrow("Forbidden");

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.clerkInvitationId).toBeUndefined();
});

test("updateStudentInvitationClerkId: admin can patch the Clerk id", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "clerk-b-ok");
  const id = await seedStudentInvitation(t, {
    email: "ivy@example.com",
    instructorId,
    status: "pending",
  });
  await seedUser(t, { userId: "user_admin_b4", role: "admin" });

  await t
    .withIdentity({ subject: "user_admin_b4" })
    .mutation(api.studentInvitations.updateStudentInvitationClerkId, {
      invitationId: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      clerkInvitationId: "inv_new_legitimate",
    });

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.clerkInvitationId).toBe("inv_new_legitimate");
});

// -------------------------------------------------------------------
// `migrateInvitation` is intentionally ungated (migration CLI contract)
// -------------------------------------------------------------------

test("migrateInvitation: still publicly callable (system migration CLI)", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "migrate-b-system");

  await t.mutation(api.studentInvitations.migrateInvitation, {
    id: "legacy_id_001",
    email: "jack@example.com",
    instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    status: "pending",
  });

  const rows = await t.run(async (ctx) =>
    await ctx.db.query("studentInvitations").collect()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].email).toBe("jack@example.com");
});

// -------------------------------------------------------------------
// `resendStudentInvitation` mutation
// -------------------------------------------------------------------

test("resendStudentInvitation: rejects non-admin/support", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "resend-b-reject");
  const id = await seedStudentInvitation(t, {
    email: "kate@example.com",
    instructorId,
    status: "pending",
    clerkInvitationId: "inv_old",
  });
  await seedUser(t, { userId: "user_student_b4", role: "student" });

  await expect(
    t.withIdentity({ subject: "user_student_b4" }).mutation(
      api.studentInvitations.resendStudentInvitation,
      {
        invitationId: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        newClerkInvitationId: "inv_new",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
    )
  ).rejects.toThrow("Forbidden");
});

test("resendStudentInvitation: admin flips pending/expired to pending, patches row", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "resend-b-ok");
  await seedUser(t, { userId: "user_admin_b5", role: "admin" });

  const pendingId = await seedStudentInvitation(t, {
    email: "leo@example.com",
    instructorId,
    status: "pending",
    clerkInvitationId: "inv_old_pending",
  });
  const expiredId = await seedStudentInvitation(t, {
    email: "mia@example.com",
    instructorId,
    status: "expired",
    clerkInvitationId: "inv_old_expired",
  });

  const newExpires = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await t
    .withIdentity({ subject: "user_admin_b5" })
    .mutation(api.studentInvitations.resendStudentInvitation, {
      invitationId: pendingId as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      newClerkInvitationId: "inv_new_pending",
      expiresAt: newExpires,
    });
  await t
    .withIdentity({ subject: "user_admin_b5" })
    .mutation(api.studentInvitations.resendStudentInvitation, {
      invitationId: expiredId as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      newClerkInvitationId: "inv_new_expired",
      expiresAt: newExpires,
    });

  const pendingRow = await t.run(async (ctx) => await ctx.db.get(pendingId));
  expect(pendingRow?.clerkInvitationId).toBe("inv_new_pending");
  expect(pendingRow?.status).toBe("pending");
  expect(pendingRow?.expiresAt).toBe(newExpires);

  const expiredRow = await t.run(async (ctx) => await ctx.db.get(expiredId));
  expect(expiredRow?.clerkInvitationId).toBe("inv_new_expired");
  expect(expiredRow?.status).toBe("pending");
});

test("resendStudentInvitation: refuses terminal statuses (accepted, cancelled)", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "resend-b-terminal");
  await seedUser(t, { userId: "user_admin_b6", role: "admin" });

  const acceptedId = await seedStudentInvitation(t, {
    email: "noah@example.com",
    instructorId,
    status: "accepted",
    clerkInvitationId: "inv_old_accepted",
  });
  const cancelledId = await seedStudentInvitation(t, {
    email: "olive@example.com",
    instructorId,
    status: "cancelled",
    clerkInvitationId: "inv_old_cancelled",
  });

  await expect(
    t.withIdentity({ subject: "user_admin_b6" }).mutation(
      api.studentInvitations.resendStudentInvitation,
      {
        invitationId: acceptedId as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        newClerkInvitationId: "inv_should_not_write",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
    )
  ).rejects.toThrow("Cannot resend invitation from terminal status 'accepted'");

  await expect(
    t.withIdentity({ subject: "user_admin_b6" }).mutation(
      api.studentInvitations.resendStudentInvitation,
      {
        invitationId: cancelledId as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        newClerkInvitationId: "inv_should_not_write",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
    )
  ).rejects.toThrow("Cannot resend invitation from terminal status 'cancelled'");

  // Confirm the rows were NOT mutated.
  const acceptedRow = await t.run(async (ctx) => await ctx.db.get(acceptedId));
  expect(acceptedRow?.clerkInvitationId).toBe("inv_old_accepted");
  expect(acceptedRow?.status).toBe("accepted");

  const cancelledRow = await t.run(async (ctx) => await ctx.db.get(cancelledId));
  expect(cancelledRow?.clerkInvitationId).toBe("inv_old_cancelled");
  expect(cancelledRow?.status).toBe("cancelled");
});

test("resendStudentInvitation: writes an audit log entry", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "resend-b-audit");
  await seedUser(t, { userId: "user_admin_b7", role: "admin" });

  const id = await seedStudentInvitation(t, {
    email: "peggy@example.com",
    instructorId,
    status: "pending",
    clerkInvitationId: "inv_audit_old",
  });

  await t
    .withIdentity({ subject: "user_admin_b7" })
    .mutation(api.studentInvitations.resendStudentInvitation, {
      invitationId: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      newClerkInvitationId: "inv_audit_new",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

  const audits = await t.run(async (ctx) =>
    await ctx.db.query("auditLogs").collect()
  );
  const match = audits.find((a) => a.action === "resend_student_invitation");
  expect(match).toBeDefined();
  expect(match?.targetId).toBe(id);
});

// -------------------------------------------------------------------
// `findPendingStudentInvitationByEmailInternal` /
// `acceptStudentInvitationByIdInternal` (used by Inngest link flow)
// -------------------------------------------------------------------

test("Inngest link flow: list-pending-by-email + accept-by-id work end-to-end", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "link-b-flow");

  await t.mutation(api.studentInvitations.migrateInvitation, {
    id: "legacy_quinn",
    email: "quinn@example.com",
    instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    status: "pending",
    clerkInvitationId: "inv_pending_quinn",
  });

  const found = await t.query(
    internal.studentInvitations.findPendingStudentInvitationByEmailInternal,
    { email: "quinn@example.com" }
  );
  expect(found).not.toBeNull();
  expect(found?.email).toBe("quinn@example.com");
  expect(found?.status).toBe("pending");

  // Pull the id via a re-query of the table — `internalQuery` returns a
  // serialized shape that doesn't include `_id` in this fork.
  const rows = await t.run(async (ctx) =>
    await ctx.db
      .query("studentInvitations")
      .withIndex("by_email", (q) =>
        q.eq("email", "quinn@example.com")
      )
      .collect()
  );
  const studentInvitationId = rows[0]._id;

  const acceptResult = await t.mutation(
    internal.studentInvitations.acceptStudentInvitationByIdInternal,
    { invitationId: studentInvitationId }
  );
  expect(acceptResult).toEqual({ accepted: true, previousStatus: "pending" });

  const acceptedRow = await t.run(async (ctx) =>
    await ctx.db.get(studentInvitationId)
  );
  expect(acceptedRow?.status).toBe("accepted");
});

test("acceptStudentInvitationByIdInternal: refuses terminal status", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "link-b-terminal");

  await t.mutation(api.studentInvitations.migrateInvitation, {
    id: "legacy_ruth",
    email: "ruth@example.com",
    instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    status: "cancelled",
  });

  const rows = await t.run(async (ctx) =>
    await ctx.db.query("studentInvitations").collect()
  );
  const id = rows[0]._id;

  const result = await t.mutation(
    internal.studentInvitations.acceptStudentInvitationByIdInternal,
    { invitationId: id }
  );
  expect(result).toEqual({ accepted: false, reason: "non_pending_cancelled" });
});

// Greptile P1 #4264777507: an already-expired row must NEVER be flipped
// back to accepted. The previous implementation only refused accepted
// and cancelled, so a row that another call marked `expired` between
// the worker's lookup and the accept patch was silently re-flipped.
test("acceptStudentInvitationByIdInternal: refuses already-expired row (does not re-accept)", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "link-b-expired");

  // Seed via migrateInvitation with `status: "expired"` directly, not
  // through the expiresAt shortcut (which would re-write "pending").
  await t.mutation(api.studentInvitations.migrateInvitation, {
    id: "legacy_sam",
    email: "sam@example.com",
    instructorId: instructorId as unknown as import("./_generated/dataModel").Id<"instructors">,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    status: "expired",
  });

  const rows = await t.run(async (ctx) =>
    await ctx.db.query("studentInvitations").collect()
  );
  const id = rows[0]._id;

  const result = await t.mutation(
    internal.studentInvitations.acceptStudentInvitationByIdInternal,
    { invitationId: id }
  );
  expect(result).toEqual({ accepted: false, reason: "non_pending_expired" });

  // Confirm the row was NOT mutated back to accepted.
  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("expired");
});

// Greptile P1 #4264777500: a "linked admin" whose role is stored on a
// `users` row found through `by_clerkId` rather than `by_userId` must
// still pass the admin gate. PR-A's admin-merge work explicitly
// tracked this case (see `convex/admin.test.ts:93-160`).
test("requireAdminOrSupport (admin-gated mutations): linked admin via by_clerkId is permitted", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "linked-b-clerkId");

  // Seed TWO users rows sharing one Clerk userId. The first row has a
  // non-admin role (instructor), the second has `admin`. The gate
  // should look across both indexes and accept whichever row has the
  // admin role.
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "clerk_user_linked_b",
      clerkId: "clerk_user_linked_b",
      email: "linked-admin@example.com",
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: "clerk_user_linked_b_NODE_2",
      clerkId: "clerk_user_linked_b",
      email: "linked-admin-2@example.com",
      role: "admin",
    });
  });
  await seedStudentInvitation(t, {
    email: "linked-b@example.com",
    instructorId,
    status: "pending",
  });

  const rows = await t.run(async (ctx) =>
    await ctx.db.query("studentInvitations").collect()
  );
  const id = rows[0]._id;

  // Should NOT throw — the gate finds the admin row via by_clerkId.
  await t
    .withIdentity({ subject: "clerk_user_linked_b" })
    .mutation(api.studentInvitations.updateStudentInvitationStatus, {
      id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      status: "cancelled",
    });

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("cancelled");
});

// Greptile round-2 P1 (cancel/route.ts:119): the cancel / resend HTTP
// routes pass `expectedStatus = row.status` from their initial read.
// If the row's status has been flipped by a parallel mutation, the
// precondition refuses. Pin that contract on
// `updateStudentInvitationStatus` and `resendStudentInvitation`.
test("updateStudentInvitationStatus: expectedStatus precondition refuses on race", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "precond-b-cancel");
  await seedUser(t, { userId: "user_admin_b8", role: "admin" });
  const id = await seedStudentInvitation(t, {
    email: "tina@example.com",
    instructorId,
    status: "pending",
  });

  // First commit flips the row to cancelled.
  await t
    .withIdentity({ subject: "user_admin_b8" })
    .mutation(api.studentInvitations.updateStudentInvitationStatus, {
      id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      status: "cancelled",
    });

  // A second commit still passes expectedStatus="pending" — refuses.
  await expect(
    t.withIdentity({ subject: "user_admin_b8" }).mutation(
      api.studentInvitations.updateStudentInvitationStatus,
      {
        id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        status: "cancelled",
        expectedStatus: "pending",
      }
    )
  ).rejects.toThrow(/Precondition mismatch/);
});

test("updateStudentInvitationStatus: expectedStatus matching current is permitted", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "precond-b-cancel-ok");
  await seedUser(t, { userId: "user_admin_b9", role: "admin" });
  const id = await seedStudentInvitation(t, {
    email: "uma@example.com",
    instructorId,
    status: "pending",
  });

  await t
    .withIdentity({ subject: "user_admin_b9" })
    .mutation(api.studentInvitations.updateStudentInvitationStatus, {
      id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      status: "expired",
      expectedStatus: "pending",
    });

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("expired");
});

test("resendStudentInvitation: refuses on race where row is now terminal", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "precond-b-resend");
  await seedUser(t, { userId: "user_admin_b10", role: "admin" });
  const id = await seedStudentInvitation(t, {
    email: "victor@example.com",
    instructorId,
    status: "pending",
    clerkInvitationId: "inv_old_v",
  });

  // Flip to cancelled first.
  await t
    .withIdentity({ subject: "user_admin_b10" })
    .mutation(api.studentInvitations.updateStudentInvitationStatus, {
      id: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
      status: "cancelled",
    });

  // Now a resend that was issued earlier in the path tries to commit.
  // Handler prioritises the terminal-status refusal, so the error
  // message is "Cannot resend from terminal status 'cancelled'".
  // Granted `expectedStatus: "pending"`, the row is `cancelled`, so a
  // resend MUST refuse (no second row, no overwrite of the cancel
  // audit log). The exact error wording is a contract of the
  // terminal check, not the precondition check.
  await expect(
    t.withIdentity({ subject: "user_admin_b10" }).mutation(
      api.studentInvitations.resendStudentInvitation,
      {
        invitationId: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        newClerkInvitationId: "inv_should_not_write",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        expectedStatus: "pending",
      }
    )
  ).rejects.toThrow(/terminal status 'cancelled'/);

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("cancelled");
  expect(row?.clerkInvitationId).toBe("inv_old_v");
});

test("resendStudentInvitation: expectedStatus precondition refuses on non-terminal mismatch (pending → expired)", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await seedInstructor(t, "precond-b-resend-nonterminal");
  await seedUser(t, { userId: "user_admin_b11", role: "admin" });
  const id = await seedStudentInvitation(t, {
    email: "wendy@example.com",
    instructorId,
    status: "pending",
    clerkInvitationId: "inv_old_w",
    expiresAt: Date.now() - 1000,
  });

  // A parallel auto-expiry marked the row "expired" between the route
  // read and the resend patch. Terminal check is skipped (expired
  // isn't refused in resend), but the precondition catches the race.
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { status: "expired" });
  });

  await expect(
    t.withIdentity({ subject: "user_admin_b11" }).mutation(
      api.studentInvitations.resendStudentInvitation,
      {
        invitationId: id as unknown as import("./_generated/dataModel").Id<"studentInvitations">,
        newClerkInvitationId: "inv_should_not_write_2",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        expectedStatus: "pending",
      }
    )
  ).rejects.toThrow(/Precondition mismatch/);

  const row = await t.run(async (ctx) => await ctx.db.get(id));
  expect(row?.status).toBe("expired");
  expect(row?.clerkInvitationId).toBe("inv_old_w");
});
