import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAuditLog } from "./auditLog";

/**
 * Gate all admin-or-support-only entry points.
 *
 * Mirrors the canonical pattern in `convex/adminOnboarding.ts:152-163`.
 * Returns `{ ok: true, role }` so callers can record the role in
 * `auditLogs`; returns `{ ok: false }` for any other identity.
 *
 * Throw shape: `"Forbidden: admin or support role required"` so the
 * HTTP-layer message mapping in apps/platform can detect it as a 403
 * via substring match (matches the onboarding-resend error mapping).
 */
async function requireAdminOrSupport(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<{ ok: true; role: "admin" | "support" } | { ok: false }> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (user?.role === "admin") return { ok: true, role: "admin" };
  if (user?.role === "support") return { ok: true, role: "support" };
  return { ok: false };
}

/**
 * Lists student invitations with optional filtering by status, instructor, and pagination.
 * Returns items with instructor details attached.
 *
 * R14 / PR-B (Issue 3): gated on admin-or-support — the prior
 * implementation only required an authenticated identity, which means
 * any signed-in user (student, instructor) could read every pending
 * invitation row, including student email addresses — PII. The gate
 * matches the `getAdminStudentInvitations` HTTP route's `requireRoleForApi("admin")`
 * so the read surface can't be opened by skipping the route layer.
 */
export const listStudentInvitations = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"), v.literal("all"))),
    instructorId: v.optional(v.id("instructors")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], total: 0 };

    const gate = await requireAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      throw new Error("Forbidden: admin or support role required");
    }

    let invitationsQuery = ctx.db.query("studentInvitations");

    let invitations = await invitationsQuery.collect();

    if (args.status && args.status !== "all") {
      invitations = invitations.filter(inv => inv.status === args.status);
    }

    if (args.instructorId) {
      invitations = invitations.filter(inv => inv.instructorId === args.instructorId);
    }

    const total = invitations.length;

    invitations = invitations.sort((a, b) => b._creationTime - a._creationTime);

    const offset = args.offset ?? 0;
    const limit = args.limit ?? 20;
    invitations = invitations.slice(offset, offset + limit);

    const results = await Promise.all(
      invitations.map(async (inv) => {
        const instructor = await ctx.db.get(inv.instructorId);
        return {
          id: inv._id,
          email: inv.email,
          instructorId: inv.instructorId,
          instructorName: instructor?.name ?? null,
          instructorSlug: instructor?.slug ?? null,
          clerkInvitationId: inv.clerkInvitationId ?? null,
          expiresAt: inv.expiresAt,
          status: inv.status,
          createdAt: inv._creationTime,
        };
      })
    );

    return { items: results, total };
  },
});

/**
 * Creates a new student invitation for an instructor.
 * Prevents duplicate pending invitations for the same email and instructor combination.
 *
 * R14 / PR-B (Issue 3): gated on admin-or-support. Previously callable
 * by any signed-in user, which let a non-admin create student invitation
 * rows. The HTTP `/api/admin/students/invite` route already required
 * admin, but the mutation had no second line of defense — anyone calling
 * Convex directly could mint a row and an `updateStudentInvitationClerkId`
 * pair on it, redirecting the invite to a different Clerk account. The
 * gate closes that path.
 */
export const createStudentInvitation = mutation({
  args: {
    email: v.string(),
    instructorId: v.id("instructors"),
    clerkInvitationId: v.optional(v.string()),
    expiresAt: v.number(),
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const gate = await requireAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      throw new Error("Forbidden: admin or support role required");
    }

    const existingPending = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email_instructorId", (q) =>
        q.eq("email", args.email.toLowerCase()).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingPending && existingPending.status === "pending" && existingPending.expiresAt > Date.now()) {
      throw new Error("A pending invitation already exists for this email and instructor");
    }

    const invitationId = await ctx.db.insert("studentInvitations", {
      email: args.email.toLowerCase(),
      instructorId: args.instructorId,
      clerkInvitationId: args.clerkInvitationId ?? undefined,
      expiresAt: args.expiresAt,
      status: args.status ?? "pending",
    });

    return invitationId;
  },
});

/**
 * Updates the status of a student invitation (pending, accepted, expired, cancelled).
 * Requires admin or support role.
 *
 * PR-B (Issue 3): the prior gate was `if (!identity) throw new
 * Error("Unauthorized")`, which let any signed-in user flip any
 * invitation's status — a miscreant could cancel a legitimate
 * invitation or revive a cancelled one. Refuse on `accepted`/`cancelled`
 * resends but keep status flips available to admins so the UI's Cancel
 * button can write directly from React Query without a separate route.
 *
 * Writes an `auditLogs` row so a future security review can replay who
 * cancelled which invitation — the onboarding-resend pattern
 * (`convex/adminOnboarding.ts:749-762`) does the same.
 */
export const updateStudentInvitationStatus = mutation({
  args: {
    id: v.id("studentInvitations"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const gate = await requireAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      throw new Error("Forbidden: admin or support role required");
    }

    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Student invitation not found");

    const previousStatus = row.status;
    await ctx.db.patch(args.id, { status: args.status });

    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: gate.role,
      action: "update_student_invitation_status",
      targetType: "studentInvitation",
      targetId: args.id,
      details: `Status changed from ${previousStatus} to ${args.status} (instructorId=${row.instructorId}, email=${row.email})`,
      metadata: {
        previousStatus,
        newStatus: args.status,
        email: row.email,
        instructorId: row.instructorId,
      },
    });

    return args.id;
  },
});

/**
 * Updates the clerkInvitationId of a student invitation.
 * Called after successfully creating a Clerk invitation to link them.
 *
 * PR-B (Issue 3): gated on admin-or-support. Previously any signed-in
 * user could patch a different `clerkInvitationId` onto a row and
 * effectively redirect the signup link. The gate closes that path.
 */
export const updateStudentInvitationClerkId = mutation({
  args: {
    invitationId: v.id("studentInvitations"),
    clerkInvitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const gate = await requireAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      throw new Error("Forbidden: admin or support role required");
    }

    const row = await ctx.db.get(args.invitationId);
    if (!row) throw new Error("Student invitation not found");

    const previousClerkId = row.clerkInvitationId ?? null;
    await ctx.db.patch(args.invitationId, { clerkInvitationId: args.clerkInvitationId });

    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: gate.role,
      action: "update_student_invitation_clerk_id",
      targetType: "studentInvitation",
      targetId: args.invitationId,
      details: `Re-linked Clerk invitation (previous=${previousClerkId ?? "(none)"}, new=${args.clerkInvitationId}, email=${row.email})`,
      metadata: {
        previousClerkInvitationId: previousClerkId,
        newClerkInvitationId: args.clerkInvitationId,
        email: row.email,
        instructorId: row.instructorId,
      },
    });

    return args.invitationId;
  },
});

/**
 * Resend an existing student invitation without creating a second row.
 *
 * - Pattern role: matches `convex/adminOnboarding.ts:704-771`
 *   (`resendAdminOnboardingInvitation`). The HTTP route at
 *   `apps/platform/app/api/admin/students/invitations/[id]/resend/route.ts`
 *   mints a fresh Clerk invitation first, then calls this mutation to
 *   patch the row's `clerkInvitationId`, `expiresAt`, and reset `status`
 *   to `pending`. We never create a second row.
 * - Idempotency: refuses if the row's current status is `accepted` or
 *   `cancelled`. Both are terminal semantically — the student either
 *   signed up (don't re-invite) or the admin cancelled (don't auto-
 *   revive). `expired` and `pending` are resendable.
 * - Audit log: writes one `resend_student_invitation` entry per call.
 *
 * The 7-day `expiresAt` matches the original `/api/admin/students/invite`
 * POST (`apps/platform/app/api/admin/students/invite/route.ts:91`).
 */
export const resendStudentInvitation = mutation({
  args: {
    invitationId: v.id("studentInvitations"),
    newClerkInvitationId: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const gate = await requireAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      throw new Error("Forbidden: admin or support role required");
    }

    const row = await ctx.db.get(args.invitationId);
    if (!row) throw new Error("Student invitation not found");

    if (row.status === "accepted" || row.status === "cancelled") {
      throw new Error(
        `Cannot resend invitation from terminal status '${row.status}'`
      );
    }

    const previousClerkInvitationId = row.clerkInvitationId ?? null;
    const previousStatus = row.status;

    await ctx.db.patch(args.invitationId, {
      clerkInvitationId: args.newClerkInvitationId,
      expiresAt: args.expiresAt,
      status: "pending",
    });

    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: gate.role,
      action: "resend_student_invitation",
      targetType: "studentInvitation",
      targetId: args.invitationId,
      details: `Resent Clerk invitation (prev=${previousClerkInvitationId ?? "(none)"} new=${args.newClerkInvitationId}, prior status=${previousStatus})`,
      metadata: {
        previousClerkInvitationId,
        newClerkInvitationId: args.newClerkInvitationId,
        previousStatus,
        newStatus: "pending",
        email: row.email,
        instructorId: row.instructorId,
      },
    });

    return {
      invitationId: args.invitationId,
      previousStatus,
      previousClerkInvitationId,
      newClerkInvitationId: args.newClerkInvitationId,
    };
  },
});

/**
 * Returns a single invitation by id for the resend route. Public but
 * gated on admin-or-support — the resend route (and any future admin
 * detail view) obtains the row without exposing PII to non-admins.
 */
export const getStudentInvitationById = query({
  args: { id: v.id("studentInvitations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const gate = await requireAdminOrSupport(ctx, identity.subject);
    if (!gate.ok) {
      throw new Error("Forbidden: admin or support role required");
    }

    const row = await ctx.db.get(args.id);
    if (!row) return null;

    return {
      id: row._id,
      email: row.email,
      instructorId: row.instructorId,
      clerkInvitationId: row.clerkInvitationId ?? null,
      expiresAt: row.expiresAt,
      status: row.status,
      createdAt: row._creationTime,
    };
  },
});

/**
 * Migrates a student invitation from legacy system.
 * Updates existing invitation if found by email and instructor, otherwise creates new.
 *
 * PR-B (Issue 3): migration-script callable. INTENTIONALLY left without
 * a `requireAdminOrSupport` gate — callers here are `npx convex run`
 * invocations from the legacy student-invitation migration CLI which
 * authenticate with `CONVEX_DEPLOY_KEY` (deployment-admin) and have no
 * Clerk user identity. Putting a `users.role` check here would break
 * the migration CLI.
 *
 * Hardening path (future PR, NOT in scope here): convert this to an
 * `internalMutation`-only export, add a bearer-auth HTTP endpoint at
 * `/internal/migrate-student-invitation` mirroring the existing
 * `httpCreateInstructorForClerkUser` precedent (`convex/http.ts:1704+`),
 * and update the legacy migration CLI to use `convexServerCall` instead
 * of `npx convex run`. That keeps `studentInvitations.createStudentInvitation`'s
 * admin-gate airtight without breaking the one-shot CLI flow.
 */
export const migrateInvitation = mutation({
  args: {
    id: v.string(),
    email: v.string(),
    instructorId: v.id("instructors"),
    clerkInvitationId: v.optional(v.string()),
    expiresAt: v.number(),
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"))),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase();

    const existingByEmailInstructor = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email_instructorId", (q) =>
        q.eq("email", normalizedEmail).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingByEmailInstructor) {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (args.clerkInvitationId) updates.clerkInvitationId = args.clerkInvitationId;
      if (args.expiresAt) updates.expiresAt = args.expiresAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByEmailInstructor._id, updates);
      }
      return { action: "updated", id: existingByEmailInstructor._id };
    }

    const insertResult = await ctx.db.insert("studentInvitations", {
      email: normalizedEmail,
      instructorId: args.instructorId,
      clerkInvitationId: args.clerkInvitationId ?? undefined,
      expiresAt: args.expiresAt,
      status: args.status ?? "pending",
    });

    return { action: "inserted", id: insertResult };
  },
});

/**
 * PR-B (Issue 3) internals used by `apps/web/inngest/functions/clerk-user-linking.ts`
 * and the bearer-auth `convex/http.ts` endpoints. After the admin gate
 * was added to `listStudentInvitations` / `updateStudentInvitationStatus`,
 * the Inngest function (which runs without a Clerk user identity) could
 * no longer call them. These internals — together with the matching
 * `*_by_email` and `*_by_id` HTTP endpoints — let the Inngest function
 * run its `clerk/user.created` link-student flow as a service-key actor.
 */

/** Find a pending student invitation by email (case-insensitive). */
export const findPendingStudentInvitationByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{
    id: string;
    email: string;
    instructorId: string;
    clerkInvitationId: string | null;
    expiresAt: number;
    status: string;
    createdAt: number;
  } | null> => {
    const normalized = args.email.toLowerCase();
    const candidates = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .collect();
    const pending = candidates.find(
      (inv) => inv.status === "pending" && inv.expiresAt > Date.now()
    );
    if (!pending) return null;
    return {
      id: pending._id,
      email: pending.email,
      instructorId: pending.instructorId,
      clerkInvitationId: pending.clerkInvitationId ?? null,
      expiresAt: pending.expiresAt,
      status: pending.status,
      createdAt: pending._creationTime,
    };
  },
});

/** Accept a pending student invitation by id. Returns true if the row was flipped, false if it was missing or already terminal. */
export const acceptStudentInvitationByIdInternal = internalMutation({
  args: { invitationId: v.id("studentInvitations") },
  handler: async (ctx, args): Promise<{ accepted: true; previousStatus: string } | { accepted: false; reason: string }> => {
    const row = await ctx.db.get(args.invitationId);
    if (!row) return { accepted: false, reason: "not_found" };
    if (row.status === "accepted" || row.status === "cancelled") {
      return { accepted: false, reason: `terminal_${row.status}` };
    }
    if (row.expiresAt <= Date.now() && row.status === "pending") {
      // Per spec, letting an expired+pending row be silently auto-accepted
      // would let a stale invite signed up after expiry. Flip to `expired`.
      await ctx.db.patch(args.invitationId, { status: "expired" });
      await writeAuditLog(ctx, {
        actorId: "system:clerk-user-linking",
        actorRole: "system",
        action: "auto_expire_student_invitation",
        targetType: "studentInvitation",
        targetId: args.invitationId,
        details: `Invitation was pending but past expiresAt (${row.expiresAt} vs now=${Date.now()}). Marked expired before accept attempt.`,
        metadata: { email: row.email, instructorId: row.instructorId },
      });
      return { accepted: false, reason: "expired" };
    }
    const previousStatus = row.status;
    await ctx.db.patch(args.invitationId, { status: "accepted" });
    await writeAuditLog(ctx, {
      actorId: "system:clerk-user-linking",
      actorRole: "system",
      action: "auto_accept_student_invitation",
      targetType: "studentInvitation",
      targetId: args.invitationId,
      details: `Auto-accepted pending invitation on clerk/user.created`,
      metadata: {
        previousStatus,
        newStatus: "accepted",
        email: row.email,
        instructorId: row.instructorId,
      },
    });
    return { accepted: true, previousStatus };
  },
});
