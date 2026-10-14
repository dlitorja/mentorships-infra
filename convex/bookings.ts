import { query, mutation, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

/** Fetch a booking by id */
export const getBookingById = query({
  args: { id: v.id("bookings") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const booking = await ctx.db.get(args.id);
    if (!booking) return null;
    // Only creator or owning instructor's user can read
    if (booking.createdByUserId === identity.subject) return booking;
    const instructor = await ctx.db.get(booking.instructorId);
    if (instructor && instructor.userId === identity.subject) return booking;
    return null;
  },
});

/** Create a pending booking as a lock before external write */
export const createPending = mutation({
  args: {
    instructorId: v.id("instructors"),
    startUtc: v.number(),
    endUtc: v.number(),
    timezone: v.string(),
    studentEmail: v.string(),
    studentName: v.string(),
    idempotencyKey: v.string(),
    createdByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // Idempotency check FIRST \u2014 Greptile round-6 P2:
    // If a previous call already created (or confirmed) a booking
    // for this `idempotencyKey`, return that row immediately without
    // re-running any mutable state checks. A student who archives
    // their only workspace mid-flight then retries the POST should
    // still get the canonical "your booking already exists" response
    // \u2014 not a generic 500. The archive guard below only fires on
    // genuinely NEW booking creation.
    const existing = await ctx.db
      .query("bookings")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing && (existing.status === "pending" || existing.status === "confirmed")) {
      return { conflict: true as const, bookingId: existing._id };
    }

    // PR archive-gating: a caller whose ONLY eligible workspace pair
    // with this instructor is archived or ended should not be able to
    // submit a fresh calendar booking. The archive UI explicitly says
    // "this workspace is no longer bookable", so creating a calendar
    // event then confirming it would silently contradict the user's
    // intent. The check is positive on workspace ownership — we apply
    // it whenever the caller owns any eligible pair with this
    // instructor — and bypasses it ONLY when the caller is a confirmed
    // staff member (admin / support / instructor) per their `users`
    // row role. Staff may still book on a student's behalf even when
    // the student has archived the relationship (manual reconciliation
    // scenarios call for this; e.g. an admin scheduling a follow-up
    // on a refund dispute).
    //
    // Greptile round-5 #1: do NOT rely on `users.role === "student"`
    // as the gate. The user's row may be missing (early-in-onboarding
    // students whose Clerk subject is linked to a `workspaces.ownerId`
    // but not yet to a full profile) or have an unset role. Treating
    // those callers as "not a student" silently skips the archive
    // check. Workspace ownership IS the structural truth and is the
    // only durable check we can rely on.
    const callerIsStaff = await isStaffCaller(ctx, identity.subject);
    const callerPairs = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", identity.subject))
      .collect();
    const instructorPairs = callerPairs.filter(
      (w) =>
        w.instructorId === args.instructorId &&
        w.deletedAt === undefined &&
        (w.type === undefined || w.type === "mentorship")
    );
    if (!callerIsStaff && instructorPairs.length > 0) {
      const hasActivePair = instructorPairs.some(
        (w) => w.archivedAt === undefined && w.endedAt === undefined
      );
      if (!hasActivePair) {
        // Greptile round-7 P2: throw a NAMED ConvexError so the
        // HTTP booking routes can map it to a 409 with the friendly
        // unarchive prompt instead of letting it bubble up as a
        // generic /api/bookings -> 500 "Failed to create booking".
        // The shape { code, message } matches the pattern used by
        // `convex/sessions.ts` (line ~1678 e.g. `VIDEO_SESSION_NOT_FOUND`)
        // which both server logs and the booking route can inspect.
        // Greptile round-8 P2: distinguish the four failure shapes
        // so the student gets actionable copy. `unarchiveWorkspaceImpl`
        // clears ONLY `archivedAt` / `archivedBy` (not `endedAt`), so
        // the original generic "unarchive / open a new workspace" copy
        // was misleading for end-of-pack cases where there is no
        // archive state to undo. We now surface a tailored message +
        // a discriminator field on the ConvexError so the HTTP layer
        // can render the right CTA without re-deriving the shape.
        const allArchivedOnly = instructorPairs.every(
          (w) => w.archivedAt !== undefined && w.endedAt === undefined
        );
        const allEndedOnly = instructorPairs.every(
          (w) => w.endedAt !== undefined && w.archivedAt === undefined
        );
        const allBoth = instructorPairs.every(
          (w) => w.archivedAt !== undefined && w.endedAt !== undefined
        );
        let code:
          | "WORKSPACE_ARCHIVED_FOR_BOOKING"
          | "WORKSPACE_ENDED_FOR_BOOKING"
          | "WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING"
          | "WORKSPACE_INACTIVE_FOR_BOOKING";
        let message: string;
        if (allArchivedOnly) {
          code = "WORKSPACE_ARCHIVED_FOR_BOOKING";
          message =
            "Cannot book against this instructor: all of your mentorship workspaces with them are archived. Unarchive the workspace, then re-submit the booking.";
        } else if (allEndedOnly) {
          code = "WORKSPACE_ENDED_FOR_BOOKING";
          message =
            "Cannot book against this instructor: your session pack with them has ended. Buy a new session pack or open a new workspace to book a session.";
        } else if (allBoth) {
          code = "WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING";
          message =
            "Cannot book against this instructor: all of your workspaces are archived AND your session pack has ended. Buy a new session pack or contact support.";
        } else {
          code = "WORKSPACE_INACTIVE_FOR_BOOKING";
          message =
            "Cannot book against this instructor: none of your mentorship workspaces with them are active. Unarchive the archived ones and buy a new pack for the ended ones.";
        }
        throw new ConvexError({ code, message });
      }
    }

    const id = await ctx.db.insert("bookings", {
      instructorId: args.instructorId,
      startUtc: args.startUtc,
      endUtc: args.endUtc,
      timezone: args.timezone,
      studentEmail: args.studentEmail,
      studentName: args.studentName,
      status: "pending",
      idempotencyKey: args.idempotencyKey,
      createdByUserId: identity.subject,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { conflict: false as const, bookingId: id };
  },
});

/**
 * Internal helper used by booking / ad-hoc writer paths to identify a
 * caller who OPERATIONALLY counts as staff. Returns true when the
 * caller has a `users` row whose role is `admin`, `support`, or
 * `instructor`. Missing rows or unset roles return false — we never
 * assume staff from absence.
 *
 * Used by `createPending` (booking guard), `startAdhocCall` (ad-hoc
 * call gate), and any future writer path that needs to distinguish a
 * participant-driven write (subject to the archive guard) from a
 * staff-driven write (which can book / start calls against archived
 * relationships for manual reconciliation).
 */
async function isStaffCaller(ctx: MutationCtx, clerkSubject: string): Promise<boolean> {
  const callerUserRow = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", clerkSubject))
    .first();
  const role = callerUserRow?.role;
  return role === "admin" || role === "support" || role === "instructor";
}

/** Confirm a pending booking by attaching calendar info */
export const confirm = mutation({
  args: {
    id: v.id("bookings"),
    eventCalendarId: v.string(),
    googleEventId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error("Booking not found");
    if (booking.createdByUserId !== identity.subject) throw new Error("Forbidden");
    if (booking.status !== "pending") return booking;
    await ctx.db.patch(args.id, {
      status: "confirmed",
      eventCalendarId: args.eventCalendarId,
      googleEventId: args.googleEventId,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.id);
  },
});

/** Cancel a booking and optionally clear calendar info */
export const cancel = mutation({
  args: {
    id: v.id("bookings"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const booking = await ctx.db.get(args.id);
    if (!booking) return null;
    // Allow cancel by creator or instructor owner
    if (booking.createdByUserId !== identity.subject) {
      const instructor = await ctx.db.get(booking.instructorId);
      if (!instructor || instructor.userId !== identity.subject) {
        throw new Error("Forbidden");
      }
    }
    if (booking.status === "canceled") return booking;
    await ctx.db.patch(args.id, { status: "canceled", updatedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});

/** Mark a booking as completed */
export const complete = mutation({
  args: {
    id: v.id("bookings"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const booking = await ctx.db.get(args.id);
    if (!booking) return null;
    // Only allow instructor owner or admin
    const instructor = await ctx.db.get(booking.instructorId);
    let isAdmin = false;
    if (identity?.subject) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      isAdmin = (user as any)?.role === "admin";
    }
    if (!instructor || (instructor.userId !== identity.subject && !isAdmin)) {
      throw new Error("Forbidden");
    }
    if (booking.status === "completed") return booking;
    const now = Date.now();

    // Patch booking with completion metadata and history
    const newHistory = Array.isArray((booking as any).history)
      ? ([...(booking as any).history, { action: "completed", at: now, byUserId: identity.subject, info: args.notes || undefined }])
      : ([{ action: "completed", at: now, byUserId: identity.subject, info: args.notes || undefined }]);

    await ctx.db.patch(args.id, {
      status: "completed",
      completedAt: now,
      completedByUserId: identity.subject,
      completionNotes: args.notes || undefined,
      history: newHistory,
      updatedAt: now,
    });

    // Decrement remaining sessions for an active session pack, if possible
    try {
      // Map studentEmail -> users.userId
      const studentUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", booking.studentEmail))
        .first();
      if (studentUser) {
        // Find an active session pack for this student + instructor with remainingSessions > 0
        const packs = await ctx.db
          .query("sessionPacks")
          .withIndex("by_userId", (q) => q.eq("userId", (studentUser as any).userId))
          .collect();
        const candidates = packs
          .filter((p) => p.instructorId === booking.instructorId && p.status === "active" && p.remainingSessions > 0);
        if (candidates.length > 0) {
          // Pick the oldest purchased first to consume in order
          const target = candidates.sort((a, b) => a.purchasedAt - b.purchasedAt)[0]!;
          const newRemaining = target.remainingSessions - 1;
          await ctx.db.patch(target._id as Id<"sessionPacks">, {
            remainingSessions: newRemaining,
            status: newRemaining <= 0 ? "depleted" : target.status,
          } as any);
        }
      }
    } catch (e) {
      // Non-fatal; loggable in a future task
      console.error("Failed to decrement session pack on completion", e);
    }

    return await ctx.db.get(args.id);
  },
});

/** List bookings for an instructor, only visible to the owning instructor user */
export const listInstructorBookings = query({
  args: {
    instructorId: v.id("instructors"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || instructor.userId !== identity.subject) return [];
    const all = await ctx.db
      .query("bookings")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
    const upcoming = all
      .filter((b) => b.status !== "canceled")
      .sort((a, b) => a.startUtc - b.startUtc);
    return (args.limit ? upcoming.slice(0, args.limit) : upcoming).map((b) => ({
      id: b._id,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      studentEmail: b.studentEmail,
      status: b.status,
      googleEventId: b.googleEventId,
      eventCalendarId: b.eventCalendarId,
    }));
  },
});

/** List bookings for the current student (by email or createdByUserId) */
export const listStudentBookings = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    // Resolve email from users table by identity
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    const email = user?.email;
    if (!email) return [];

    const byEmail = await ctx.db
      .query("bookings")
      .withIndex("by_studentEmail", (q) => q.eq("studentEmail", email))
      .collect();
    const byCreator = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    const mineAlso = byCreator.filter((b) => b.createdByUserId === identity.subject);

    const combined = [...byEmail, ...mineAlso];
    const dedup = new Map<string, Doc<"bookings">>();
    for (const b of combined) dedup.set((b._id as string), b);

    const all = Array.from(dedup.values()).sort((a, b) => a.startUtc - b.startUtc);
    const out = (args.limit ? all.slice(0, args.limit) : all).map((b) => ({
      id: b._id,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      status: b.status,
      instructorId: b.instructorId,
    }));
    return out;
  },
});
