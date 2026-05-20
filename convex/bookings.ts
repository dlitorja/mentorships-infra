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
