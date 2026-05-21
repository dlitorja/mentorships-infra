import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
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
    // Enforce single booking per idempotency key
    const existing = await ctx.db
      .query("bookings")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing && (existing.status === "pending" || existing.status === "confirmed")) {
      return { conflict: true as const, bookingId: existing._id };
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
