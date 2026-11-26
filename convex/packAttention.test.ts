/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Seed = {
  instructorId: Id<"instructors">;
  packId: Id<"sessionPacks">;
  seatId: Id<"seatReservations">;
  workspaceId: Id<"workspaces">;
};

async function seed(
  t: ReturnType<typeof convexTest>,
  opts: {
    userId?: string;
    expiresAt?: number;
    lastSessionAt?: number;
    remaining?: number;
    status?: "active" | "refunded";
  } = {}
): Promise<Seed> {
  let out: Seed | null = null;
  const userId = opts.userId ?? "user_student";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_admin",
      email: "admin@example.com",
      clerkId: "user_admin",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId,
      email: "student@example.com",
      clerkId: userId,
      role: "student",
      firstName: "Sam",
      lastName: "Student",
    });

    const instructorId = await ctx.db.insert("instructors", {
      name: "Ivy Instructor",
      slug: "ivy-instructor",
      email: "ivy@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 3,
      groupInventory: 0,
      maxActiveStudents: 10,
    });

    const packId = await ctx.db.insert("sessionPacks", {
      userId,
      instructorId,
      totalSessions: 4,
      remainingSessions: opts.remaining ?? 2,
      purchasedAt: opts.lastSessionAt ?? Date.now() - 90 * 24 * 60 * 60 * 1000,
      lastSessionAt: opts.lastSessionAt,
      expiresAt: opts.expiresAt ?? Date.now() - 24 * 60 * 60 * 1000,
      status: opts.status ?? "active",
    });

    const seatId = await ctx.db.insert("seatReservations", {
      instructorId,
      userId,
      sessionPackId: packId,
      seatExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active",
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Mentorship Workspace",
      ownerId: userId,
      instructorId,
      isPublic: false,
      seatReservationId: seatId,
      studentImageCount: 0,
      instructorImageCount: 0,
    });

    out = { instructorId, packId, seatId, workspaceId };
  });

  if (!out) throw new Error("seed failed");
  return out;
}

const admin = { subject: "user_admin" };

test("lists a pack with sessions left that is past its access date", async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  const result = await t.withIdentity(admin).query(
    api.packAttention.listPacksNeedingAttention,
    {}
  );

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.remainingSessions).toBe(2);
  expect(result.rows[0]?.student.name).toBe("Sam Student");
  expect(result.rows[0]?.instructor.name).toBe("Ivy Instructor");
  expect(result.rows[0]?.reasons).toContain("expired");
  expect(result.rows[0]?.capacity).toEqual({
    inventory: 3,
    maxActiveStudents: 10,
    activeSeats: 1,
  });
});

test("rejects a student calling the queue", async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  await expect(
    t.withIdentity({ subject: "user_student" }).query(
      api.packAttention.listPacksNeedingAttention,
      {}
    )
  ).rejects.toThrow(/Forbidden/);
});

test("pause extends the pack and seat without touching status", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t);

  const before = await t.run(async (ctx) => ctx.db.get(s.packId));
  const beforeMs = before?.expiresAt ?? 0;

  await t
    .withIdentity(admin)
    .mutation(api.packAttention.pausePack, { packId: s.packId, days: 30 });

  const pack = await t.run(async (ctx) => ctx.db.get(s.packId));
  const seat = await t.run(async (ctx) => ctx.db.get(s.seatId));

  expect(pack?.status).toBe("active");
  expect(pack?.remainingSessions).toBe(2);
  // The extension is measured from max(expiresAt, now), so a pack that is
  // already overdue moves to now + 30d rather than past + 30d.
  expect(pack?.expiresAt ?? 0).toBeGreaterThanOrEqual(
    Date.now() + 30 * 24 * 60 * 60 * 1000 - 5_000
  );
  expect(pack?.expiresAt ?? 0).toBeGreaterThan(beforeMs);
  expect(seat?.status).toBe("active");
});

test("close releases the seat, ends the workspace, and requires a reason", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t);

  await expect(
    t.withIdentity(admin).mutation(api.packAttention.closePack, {
      packId: s.packId,
      reason: "",
    })
  ).rejects.toThrow(/reason/i);

  await t.withIdentity(admin).mutation(api.packAttention.closePack, {
    packId: s.packId,
    reason: "Student confirmed they are finished",
  });

  const pack = await t.run(async (ctx) => ctx.db.get(s.packId));
  const seat = await t.run(async (ctx) => ctx.db.get(s.seatId));
  const workspace = await t.run(async (ctx) => ctx.db.get(s.workspaceId));

  expect(pack?.status).toBe("expired");
  expect(seat?.status).toBe("released");
  expect(workspace?.endedAt).toBeTypeOf("number");
});

test("rollover merges unused sessions, releases the prior seat, keeps the workspace", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t);

  let newPackId: Id<"sessionPacks"> | null = null;
  await t.run(async (ctx) => {
    newPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId: s.instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
    });
  });

  const result = await t.mutation(internal.sessionPacks.rolloverPriorPacks, {
    userId: "user_student",
    instructorId: s.instructorId,
    newSessionPackId: newPackId!,
  });

  expect(result.carriedSessions).toBe(2);
  expect(result.totalSessions).toBe(6);

  const newPack = await t.run(async (ctx) => ctx.db.get(newPackId!));
  const oldPack = await t.run(async (ctx) => ctx.db.get(s.packId));
  const oldSeat = await t.run(async (ctx) => ctx.db.get(s.seatId));
  const workspace = await t.run(async (ctx) => ctx.db.get(s.workspaceId));

  expect(newPack?.totalSessions).toBe(6);
  expect(newPack?.remainingSessions).toBe(6);
  expect(oldPack?.status).toBe("expired");
  expect(oldPack?.remainingSessions).toBe(0);
  expect(oldPack?.rolledIntoPackId).toBe(newPackId);
  expect(oldSeat?.status).toBe("released");
  expect(workspace?.endedAt).toBeUndefined();

  // Re-running is a no-op.
  const second = await t.mutation(internal.sessionPacks.rolloverPriorPacks, {
    userId: "user_student",
    instructorId: s.instructorId,
    newSessionPackId: newPackId!,
  });
  expect(second.carriedSessions).toBe(0);
});

test("rollover ignores a refunded prior pack", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t, { status: "refunded" });

  let newPackId: Id<"sessionPacks"> | null = null;
  await t.run(async (ctx) => {
    newPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId: s.instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
    });
  });

  const result = await t.mutation(internal.sessionPacks.rolloverPriorPacks, {
    userId: "user_student",
    instructorId: s.instructorId,
    newSessionPackId: newPackId!,
  });

  expect(result.carriedSessions).toBe(0);
  expect(result.totalSessions).toBe(4);
});
