/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for the de-dup logic added to `hdInvitations.markInvitationAccepted`.
 *
 * Bug class:
 *   Accepting a Clerk invitation for an email that already had an
 *   `instructors` row used to insert a SECOND `instructors` row (and a
 *   second `users` row) because the mutation only checked
 *   `users.by_clerkId`, never `instructors.by_email`. Result: the
 *   "real" instructor account (already linked to a real Clerk userId)
 *   was shadowed by a placeholder row tied to a NEW Clerk user.
 *   Student workspaces assigned to the placeholder lost their
 *   instructor-of-record.
 *
 * Fix:
 *   `markInvitationAccepted` now performs an email-based lookup
 *   against `instructors.by_email` and `users.by_email` and applies
 *   the same refusal semantics as `linkClerkUserToInstructor`:
 *     - If a live row exists and its Clerk userId differs AND is a
 *       real Clerk ID, the mutation writes an audit row and throws.
 *     - If a live row exists with a placeholder Clerk ID (e.g.
 *       `seed-${slug}`, `admin-${slug}`), it is REUSED and linked
 *       to the new Clerk user.
 *     - If no live row exists, a new row is inserted (unchanged).
 */

const EMAIL = "niel.gray+dupfix@example.com";
const OLD_CLERK_USER = "user_oldNiel1234567890";
const NEW_CLERK_USER = "user_newNiel0987654321";

async function seedPendingInvitation(
  ctx: any,
  opts: { email?: string; role?: "student" | "instructor" } = {}
): Promise<string> {
  return await ctx.db.insert("hdInvitations", {
    email: (opts.email ?? EMAIL).toLowerCase(),
    role: opts.role ?? "instructor",
    status: "pending",
    invitedByUserId: "user_adminSeed0000000",
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  });
}

test("markInvitationAccepted: refuses when an instructor row already exists for the email with a different Clerk userId (Greptile P0)", async () => {
  const t = convexTest(schema, modules);
  const { invitationId, instructorId } = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: OLD_CLERK_USER,
      name: "Niel Gray",
      slug: "niel-gray",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    const invitationId = await seedPendingInvitation(ctx, { role: "instructor" });
    return { invitationId, instructorId };
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({
    success: false,
    reason: "instructor_already_linked",
    existingInstructorId: instructorId,
    existingClerkUserId: OLD_CLERK_USER,
  });

  // Anti-hijack: existing instructor.userId must NOT be mutated.
  const instructorAfter = await t.run(async (ctx) => {
    return await ctx.db.get(instructorId as string);
  });
  expect(instructorAfter?.userId).toBe(OLD_CLERK_USER);

  // No duplicate instructor inserted.
  const allInstructorsForEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", EMAIL.toLowerCase()))
      .collect();
  });
  expect(allInstructorsForEmail).toHaveLength(1);

  // No duplicate user inserted.
  const allUsersForClerkId = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", NEW_CLERK_USER))
      .collect();
  });
  expect(allUsersForClerkId).toHaveLength(0);

  // Audit row written for the refusal.
  const audits = await t.run(async (ctx) => {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action", (q) => q.eq("action", "hd_invitation_instructor_linking_refused"))
      .collect();
  });
  expect(audits).toHaveLength(1);
  expect(audits[0]?.targetId).toBe(instructorId);
  expect(audits[0]?.metadata).toMatchObject({
    email: EMAIL.toLowerCase(),
    existingClerkUserId: OLD_CLERK_USER,
    newClerkUserId: NEW_CLERK_USER,
  });
});

test("markInvitationAccepted: reuses an instructor row whose userId is a placeholder (admin-${slug}) and links it to the new Clerk user", async () => {
  const t = convexTest(schema, modules);
  const { invitationId, instructorId } = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "admin-niel-gray",
      name: "Niel Gray",
      slug: "niel-gray",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: true,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    const invitationId = await seedPendingInvitation(ctx, { role: "instructor" });
    return { invitationId, instructorId };
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({ success: true, reused: true });

  // Existing instructor reused (not duplicated).
  const allInstructorsForEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", EMAIL.toLowerCase()))
      .collect();
  });
  expect(allInstructorsForEmail).toHaveLength(1);

  const instructorAfter = await t.run(async (ctx) => {
    return await ctx.db.get(instructorId as string);
  });
  expect(instructorAfter?.userId).toBe(NEW_CLERK_USER);

  // User row created for the new Clerk user.
  const usersForNewClerk = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", NEW_CLERK_USER))
      .collect();
  });
  expect(usersForNewClerk).toHaveLength(1);

  // Audit row written for the reuse.
  const audits = await t.run(async (ctx) => {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action", (q) => q.eq("action", "link_existing_instructor_to_new_clerk_user_from_invitation"))
      .collect();
  });
  expect(audits).toHaveLength(1);
  expect(audits[0]?.targetId).toBe(instructorId);
});

test("markInvitationAccepted: refuses when a users row already exists for the email with a different Clerk userId", async () => {
  const t = convexTest(schema, modules);
  const { invitationId } = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: OLD_CLERK_USER,
      clerkId: OLD_CLERK_USER,
      email: EMAIL.toLowerCase(),
      role: "student",
    });
    const invitationId = await seedPendingInvitation(ctx, { role: "instructor" });
    return { invitationId };
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({
    success: false,
    reason: "user_already_linked",
    existingClerkUserId: OLD_CLERK_USER,
  });

  // No duplicate user inserted.
  const usersForEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", EMAIL.toLowerCase()))
      .collect();
  });
  expect(usersForEmail).toHaveLength(1);

  // Audit row written for the user refusal.
  const audits = await t.run(async (ctx) => {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action", (q) => q.eq("action", "hd_invitation_user_linking_refused"))
      .collect();
  });
  expect(audits).toHaveLength(1);
});

test("markInvitationAccepted: inserts a fresh user + instructor when no existing rows match", async () => {
  const t = convexTest(schema, modules);
  const invitationId = await t.run(async (ctx) => {
    return await seedPendingInvitation(ctx, { role: "instructor" });
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({ success: true, reused: false });

  const usersForNewClerk = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", NEW_CLERK_USER))
      .collect();
  });
  expect(usersForNewClerk).toHaveLength(1);
  expect(usersForNewClerk[0]?.role).toBe("instructor");

  const instructorsForEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", EMAIL.toLowerCase()))
      .collect();
  });
  expect(instructorsForEmail).toHaveLength(1);
  expect(instructorsForEmail[0]?.userId).toBe(NEW_CLERK_USER);
});

test("markInvitationAccepted: refused invitations stay 'pending' (Greptile P1 #1)", async () => {
  const t = convexTest(schema, modules);
  const { invitationId } = await t.run(async (ctx) => {
    await ctx.db.insert("instructors", {
      userId: OLD_CLERK_USER,
      name: "Niel Gray",
      slug: "niel-gray",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    return { invitationId: await seedPendingInvitation(ctx, { role: "instructor" }) };
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({ success: false, reason: "instructor_already_linked" });

  // Greptile P1 #1: a refusal must NOT mark the invitation accepted,
  // otherwise the next webhook retry silently succeeds without linking.
  const invitationAfter = await t.run(async (ctx) => {
    return await ctx.db.get(invitationId as string);
  });
  expect(invitationAfter?.status).toBe("pending");
});

test("markInvitationAccepted: catches ANY live instructor with a conflicting Clerk link, not just the first (Greptile P1 #2)", async () => {
  const t = convexTest(schema, modules);
  const { invitationId, conflictInstructorId } = await t.run(async (ctx) => {
    // Seed a deleted-by_clerkId placeholder that would be returned by .first()
    // under the old implementation, hiding the real conflict below it.
    await ctx.db.insert("instructors", {
      userId: "seed-placeholder-slug",
      name: "Stale Placeholder",
      slug: "stale-placeholder",
      email: EMAIL.toLowerCase(),
      isActive: false,
      isNew: true,
      maxActiveStudents: 0,
      oneOnOneInventory: 0,
      groupInventory: 0,
      deletedAt: Date.now(),
    });
    const conflictInstructorId = await ctx.db.insert("instructors", {
      userId: OLD_CLERK_USER,
      name: "Niel Gray",
      slug: "niel-gray",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    return {
      invitationId: await seedPendingInvitation(ctx, { role: "instructor" }),
      conflictInstructorId,
    };
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({
    success: false,
    reason: "instructor_already_linked",
    existingInstructorId: conflictInstructorId,
    existingClerkUserId: OLD_CLERK_USER,
  });

  // No new instructor inserted for the duplicate Clerk user.
  const instructorsForEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", EMAIL.toLowerCase()))
      .collect();
  });
  const liveInstructorUserIds = instructorsForEmail
    .filter((i) => i.deletedAt === undefined)
    .map((i) => i.userId);
  expect(liveInstructorUserIds).toEqual([OLD_CLERK_USER]);
});

test("markInvitationAccepted: reuses an instructor already linked to this Clerk user (no duplicate insert) (Greptile P1 #7)", async () => {
  const t = convexTest(schema, modules);
  const { invitationId, instructorId } = await t.run(async (ctx) => {
    // The Clerk webhook linked the instructor before our invitation
    // webhook ran. No `users` row yet for this Clerk ID.
    const instructorId = await ctx.db.insert("instructors", {
      userId: NEW_CLERK_USER,
      name: "Niel Gray",
      slug: "niel-gray",
      email: EMAIL.toLowerCase(),
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    return {
      invitationId: await seedPendingInvitation(ctx, { role: "instructor" }),
      instructorId,
    };
  });

  const result = await t.mutation(internal.hdInvitations.markInvitationAccepted, {
    invitationId: invitationId as any,
    clerkUserId: NEW_CLERK_USER,
  });

  expect(result).toMatchObject({ success: true, reused: true });

  // Exactly one instructor row, still linked to NEW_CLERK_USER.
  const instructorsForEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", EMAIL.toLowerCase()))
      .collect();
  });
  expect(instructorsForEmail).toHaveLength(1);
  expect(instructorsForEmail[0]?._id).toBe(instructorId);
  expect(instructorsForEmail[0]?.userId).toBe(NEW_CLERK_USER);

  // A user row was created (the invitation webhook also creates one),
  // but no SECOND instructor was inserted.
  const usersForNewClerk = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", NEW_CLERK_USER))
      .collect();
  });
  expect(usersForNewClerk).toHaveLength(1);
});
