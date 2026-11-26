import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAuditLog } from "./auditLog";

/**
 * Admin attention queue for packs that still have sessions left (D6).
 *
 * A pack lands here when it has `remainingSessions > 0` and either its access
 * date has passed or the student has not completed or booked a session in
 * `DORMANT_DAYS`. Nothing is revoked automatically: the row exists so staff can
 * contact the student and, when the student is dormant, raise the instructor's
 * sellable capacity so the held seat stops blocking new sales.
 *
 * Sessions are never forfeited at expiry. `pause` is for "travelling, will
 * continue"; `close` is only for a student who confirms they are finished.
 */

const DORMANT_DAYS = 45;
/** Upper bound on rows returned to the admin table (scan is larger). */
const MAX_ROWS = 500;

async function requireStaff(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  const byUserId = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();
  if (byUserId?.role === "admin" || byUserId?.role === "support") {
    return identity.subject;
  }

  // Linked-admin case: multiple users rows may share one clerkId.
  const byClerkId = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .collect();
  const linked = byClerkId.find(
    (row) => row.role === "admin" || row.role === "support"
  );
  if (!linked) throw new Error("Forbidden: admin or support role required");
  return identity.subject;
}

type StudentRow = Pick<Doc<"users">, "email" | "firstName" | "lastName">;

function studentDisplay(student: StudentRow | null, userId: string): string {
  if (!student) {
    return userId.startsWith("email:") ? userId.slice("email:".length) : "Unnamed student";
  }
  const name = [student.firstName, student.lastName].filter(Boolean).join(" ").trim();
  return name || student.email || "Unnamed student";
}

export const listPacksNeedingAttention = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStaff(ctx);

    const now = Date.now();
    const dormantCutoff = now - DORMANT_DAYS * 24 * 60 * 60 * 1000;
    const limit = Math.min(args.limit ?? 200, MAX_ROWS);

    // Read every active pack instead of a fixed slice. `active` is a small
    // set (hundreds to low thousands), and the admin queue is a low-frequency
    // read, so a scan here is cheaper than a paginated UI and cannot hide a
    // qualifying student past a page boundary.
    const activePacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const candidates = activePacks.filter((pack) => {
      if (pack.remainingSessions <= 0 || pack.deletedAt !== undefined) return false;

      const expired =
        typeof pack.expiresAt === "number" && pack.expiresAt <= now;
      // Until `backfillLastSessionAt` runs, a missing value must not mean
      // "dormant": existing packs have no field, and using `purchasedAt`
      // would flag students who attended yesterday.
      const dormant =
        pack.lastSessionAt !== undefined && pack.lastSessionAt <= dormantCutoff;

      return expired || dormant;
    });

    // Stable order: oldest activity first, so the most-neglected student is at
    // the top of the queue.
    candidates.sort(
      (a, b) => (a.lastSessionAt ?? a.purchasedAt) - (b.lastSessionAt ?? b.purchasedAt)
    );

    const capacityCache = new Map<
      string,
      { inventory: number; maxActiveStudents: number | null; activeSeats: number }
    >();

    async function capacityFor(instructorId: Id<"instructors">) {
      const cached = capacityCache.get(instructorId);
      if (cached) return cached;

      const instructor = await ctx.db.get(instructorId);
      const seats = await ctx.db
        .query("seatReservations")
        .withIndex("by_instructorId_status", (q) =>
          q.eq("instructorId", instructorId).eq("status", "active")
        )
        .collect();

      const value = {
        inventory: instructor?.oneOnOneInventory ?? 0,
        maxActiveStudents: instructor?.maxActiveStudents ?? null,
        activeSeats: seats.length,
      };
      capacityCache.set(instructorId, value);
      return value;
    }

    const rows = [];
    for (const pack of candidates.slice(0, limit)) {
      const [student, instructor, seat, capacity] = await Promise.all([
        ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", pack.userId))
          .first(),
        ctx.db.get(pack.instructorId),
        ctx.db
          .query("seatReservations")
          .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", pack._id))
          .first(),
        capacityFor(pack.instructorId),
      ]);

      const expired = typeof pack.expiresAt === "number" && pack.expiresAt <= now;
      const lastActivity = pack.lastSessionAt ?? pack.purchasedAt;
      const reasons: Array<"expired" | "dormant"> = [];
      if (expired) reasons.push("expired");
      if (lastActivity <= dormantCutoff) reasons.push("dormant");

      rows.push({
        packId: pack._id,
        userId: pack.userId,
        student: {
          email: student?.email ?? (pack.userId.startsWith("email:") ? pack.userId.slice(6) : null),
          name: studentDisplay(student ?? null, pack.userId),
        },
        instructor: {
          id: pack.instructorId,
          name: instructor?.name ?? "Instructor",
          slug: instructor?.slug ?? null,
        },
        remainingSessions: pack.remainingSessions,
        totalSessions: pack.totalSessions,
        purchasedAt: pack.purchasedAt,
        expiresAt: pack.expiresAt ?? null,
        lastSessionAt: pack.lastSessionAt ?? null,
        lastActivity,
        dormantDays: Math.floor((now - lastActivity) / (24 * 60 * 60 * 1000)),
        seatStatus: seat?.status ?? null,
        capacity,
        lastContactedAt: pack.lastContactedAt ?? null,
        reasons,
      });
    }

    return { rows, dormantDays: DORMANT_DAYS };
  },
});

/**
 * Extends a pack (and its seat) without moving money.
 *
 * This is the correct action for "travelling / unavailable, continuing later".
 * It is deliberately separate from a refund: a refund closes the pack and frees
 * the seat; a pause keeps both.
 */
export const pausePack = mutation({
  args: {
    packId: v.id("sessionPacks"),
    days: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireStaff(ctx);
    const pack = await ctx.db.get(args.packId);
    if (!pack) throw new Error("Session pack not found");

    const days = Math.min(Math.max(args.days ?? 30, 1), 365);
    const extensionMs = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const base = Math.max(pack.expiresAt ?? now, now);

    await ctx.db.patch(pack._id, { expiresAt: base + extensionMs });

    const seat = await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", pack._id))
      .first();
    if (seat) {
      const seatBase = Math.max(seat.seatExpiresAt ?? now, now);
      await ctx.db.patch(seat._id, {
        status: seat.status === "released" ? "released" : "active",
        seatExpiresAt: seatBase + extensionMs,
        gracePeriodEndsAt: undefined,
      });
    }

    await writeAuditLog(ctx, {
      actorId,
      actorRole: "admin",
      action: "pack_paused",
      targetType: "sessionPack",
      targetId: pack._id,
      details: `Paused ${days} days${args.note ? `: ${args.note}` : ""}`,
      metadata: { userId: pack.userId, instructorId: pack.instructorId, days },
    });

    return await ctx.db.get(pack._id);
  },
});

/** Records that staff contacted the student about this pack. The email itself is sent by the API route. */
export const recordPackContact = mutation({
  args: { packId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const actorId = await requireStaff(ctx);
    const pack = await ctx.db.get(args.packId);
    if (!pack) throw new Error("Session pack not found");

    await ctx.db.patch(pack._id, {
      lastContactedAt: Date.now(),
      lastContactedBy: actorId,
    });

    await writeAuditLog(ctx, {
      actorId,
      actorRole: "admin",
      action: "pack_contacted",
      targetType: "sessionPack",
      targetId: pack._id,
      details: "Contacted student about unused sessions",
      metadata: { userId: pack.userId, instructorId: pack.instructorId },
    });

    return await ctx.db.get(pack._id);
  },
});

/**
 * Closes a pack at the student's confirmation. This is the ONLY path that
 * forfeits remaining sessions, and it requires a reason.
 */
export const closePack = mutation({
  args: { packId: v.id("sessionPacks"), reason: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireStaff(ctx);
    const reason = args.reason.trim();
    if (reason.length < 3) {
      throw new Error("A reason is required to close a pack");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack) throw new Error("Session pack not found");
    if (pack.status !== "active") {
      throw new Error(
        `Pack is already ${pack.status}; refresh the queue before acting`
      );
    }

    await ctx.db.patch(pack._id, { status: "expired" });

    const seat = await ctx.db
      .query("seatReservations")
      .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", pack._id))
      .first();

    if (seat) {
      await ctx.db.patch(seat._id, { status: "released" });
      const workspaces = await ctx.db
        .query("workspaces")
        .withIndex("by_seatReservationId", (q) => q.eq("seatReservationId", seat._id))
        .collect();
      for (const workspace of workspaces) {
        await ctx.db.patch(workspace._id, { endedAt: Date.now() });
      }
    }

    await writeAuditLog(ctx, {
      actorId,
      actorRole: "admin",
      action: "pack_closed",
      targetType: "sessionPack",
      targetId: pack._id,
      details: `Closed with ${pack.remainingSessions} sessions unused: ${reason}`,
      metadata: {
        userId: pack.userId,
        instructorId: pack.instructorId,
        unusedSessions: pack.remainingSessions,
      },
    });

    return await ctx.db.get(pack._id);
  },
});

/** Server-side lookup used by the admin contact-email route so the client cannot supply arbitrary recipients. */
export const getPackForAdmin = query({
  args: { packId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const pack = await ctx.db.get(args.packId);
    if (!pack) return null;

    const [student, instructor] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", pack.userId))
        .first(),
      ctx.db.get(pack.instructorId),
    ]);

    const email =
      student?.email ??
      (pack.userId.startsWith("email:") ? pack.userId.slice("email:".length) : null);

    return {
      packId: pack._id,
      email,
      studentName: studentDisplay(student ?? null, pack.userId),
      instructorName: instructor?.name ?? "your instructor",
      remainingSessions: pack.remainingSessions,
      totalSessions: pack.totalSessions,
      expiresAt: pack.expiresAt ?? null,
    };
  },
});

/**
 * One-time backfill for `lastSessionAt` after deploy.
 *
 * Run until `remaining` is false:
 *   npx convex run internal.packAttention.backfillLastSessionAt '{"batchSize":500}'
 *
 * Until it runs, the queue deliberately treats a missing value as "recent"
 * rather than falling back to `purchasedAt`, which would mark an active student
 * dormant and create needless follow-up work.
 */
export const backfillLastSessionAt = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? 200, 1), 1000);
    const packs = await ctx.db
      .query("sessionPacks")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    let updated = 0;
    let remaining = false;

    for (const pack of packs) {
      if (pack.lastSessionAt !== undefined) continue;
      if (updated >= batchSize) {
        remaining = true;
        break;
      }

      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", pack._id))
        .collect();

      let latest = pack.purchasedAt;
      for (const session of sessions) {
        latest = Math.max(
          latest,
          session.scheduledAt ?? 0,
          session.completedAt ?? 0
        );
      }

      await ctx.db.patch(pack._id, { lastSessionAt: latest });
      updated += 1;
    }

    return { updated, remaining };
  },
});
