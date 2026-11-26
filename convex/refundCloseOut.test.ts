/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seed(t: ReturnType<typeof convexTest>, opts: {
  total?: number;
  remaining?: number;
  carried?: number;
  rolledInto?: Id<"sessionPacks">;
} = {}) {
  let out: {
    packId: Id<"sessionPacks">;
    seatId: Id<"seatReservations">;
    workspaceId: Id<"workspaces">;
    instructorId: Id<"instructors">;
    paymentId: Id<"payments">;
    orderId: Id<"orders">;
  } | null = null;

  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      name: "Refund Instructor",
      slug: "refund-instructor",
      email: "refund@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 3,
      groupInventory: 0,
      maxActiveStudents: 10,
    });

    const orderId = await ctx.db.insert("orders", {
      userId: "user_student",
      status: "paid",
      provider: "stripe",
      totalAmount: "100.00",
      currency: "usd",
    });

    const paymentId = await ctx.db.insert("payments", {
      orderId,
      provider: "stripe",
      providerPaymentId: "pi_1",
      amount: "100.00",
      currency: "usd",
      status: "completed",
    });

    const packId = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId,
      totalSessions: opts.total ?? 4,
      remainingSessions: opts.remaining ?? 2,
      purchasedAt: Date.now(),
      status: "active",
      paymentId,
      mentorshipType: "group",
      carriedSessions: opts.carried,
      rolledIntoPackId: opts.rolledInto,
    });

    const seatId = await ctx.db.insert("seatReservations", {
      instructorId,
      userId: "user_student",
      sessionPackId: packId,
      seatExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active",
    });

    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Mentorship Workspace",
      ownerId: "user_student",
      instructorId,
      isPublic: false,
      seatReservationId: seatId,
      studentImageCount: 0,
      instructorImageCount: 0,
    });

    out = { packId, seatId, workspaceId, instructorId, paymentId, orderId };
  });

  if (!out) throw new Error("seed failed");
  return out;
}

test("ordinary refund closes the pack, releases the seat, and restores the right pool", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t);

  const result = await t.mutation(internal.sessionPacks.closeOutRefund, {
    sessionPackId: s.packId,
  });

  const pack = await t.run(async (ctx) => ctx.db.get(s.packId));
  const seat = await t.run(async (ctx) => ctx.db.get(s.seatId));
  const instructor = await t.run(async (ctx) => ctx.db.get(s.instructorId));
  const workspace = await t.run(async (ctx) => ctx.db.get(s.workspaceId));

  expect(result.closed).toBe(true);
  expect(pack?.status).toBe("refunded");
  expect(seat?.status).toBe("released");
  expect(workspace?.endedAt).toBeTypeOf("number");
  // Seed marks the pack `group`; the old guess-by-session-count would have
  // restored oneOnOne instead.
  expect(instructor?.groupInventory).toBe(1);
  expect(instructor?.oneOnOneInventory).toBe(3);
});

test("refunding a pack with carried credits keeps them usable", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t, { total: 6, remaining: 5, carried: 2 });

  const result = await t.mutation(internal.sessionPacks.closeOutRefund, {
    sessionPackId: s.packId,
  });

  const pack = await t.run(async (ctx) => ctx.db.get(s.packId));
  const seat = await t.run(async (ctx) => ctx.db.get(s.seatId));
  const instructor = await t.run(async (ctx) => ctx.db.get(s.instructorId));

  expect(result.closed).toBe(false);
  expect(result.keptOpen).toBe(true);
  expect(pack?.status).toBe("active");
  expect(pack?.remainingSessions).toBe(2);
  expect(seat?.status).toBe("active");
  expect(instructor?.groupInventory).toBe(0);
});

test("refunding the old payment removes only its carried credits", async () => {
  const t = convexTest(schema, modules);

  let newPackId: Id<"sessionPacks"> | null = null;
  const s = await seed(t);
  await t.run(async (ctx) => {
    newPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId: s.instructorId,
      totalSessions: 6,
      remainingSessions: 5,
      purchasedAt: Date.now() + 1000,
      status: "active",
      carriedSessions: 2,
    });
    await ctx.db.patch(s.packId, { rolledIntoPackId: newPackId, carriedSessions: 2, remainingSessions: 0, status: "expired" });
  });

  await t.mutation(internal.sessionPacks.closeOutRefund, {
    sessionPackId: s.packId,
  });

  const destination = await t.run(async (ctx) => ctx.db.get(newPackId!));
  expect(destination?.remainingSessions).toBe(3);
  expect(destination?.totalSessions).toBe(4);
  expect(destination?.status).toBe("active");
});

test("refund close-out is idempotent", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t);

  await t.mutation(internal.sessionPacks.closeOutRefund, { sessionPackId: s.packId });
  const second = await t.mutation(internal.sessionPacks.closeOutRefund, {
    sessionPackId: s.packId,
  });

  const instructor = await t.run(async (ctx) => ctx.db.get(s.instructorId));
  expect(second.alreadyClosed).toBe(true);
  expect(instructor?.groupInventory).toBe(1);
});

test("provider refund total is applied once even when delivered twice", async () => {
  const t = convexTest(schema, modules);
  const s = await seed(t);

  const first = await t.mutation(internal.payments.applyProviderRefundTotalInternal, {
    paymentId: s.paymentId,
    refundedTotal: "10.00",
  });
  const second = await t.mutation(internal.payments.applyProviderRefundTotalInternal, {
    paymentId: s.paymentId,
    refundedTotal: "10.00",
  });

  const payment = await t.run(async (ctx) => ctx.db.get(s.paymentId));

  expect(first.applied).toBe(10);
  expect(second.applied).toBe(0);
  expect(payment?.refundedAmount).toBe("10.00");
  expect(payment?.status).toBe("completed");
});

test("a carried-credit pack that ends closed still only restores one seat", async () => {
  const t = convexTest(schema, modules);
  // 6 total = 4 purchased + 2 carried; 0 remaining means every credit,
  // including the carried ones, was used.
  const s = await seed(t, { total: 6, remaining: 0, carried: 2 });

  await t.mutation(internal.sessionPacks.closeOutRefund, { sessionPackId: s.packId });
  const second = await t.mutation(internal.sessionPacks.closeOutRefund, {
    sessionPackId: s.packId,
  });

  const instructor = await t.run(async (ctx) => ctx.db.get(s.instructorId));
  const pack = await t.run(async (ctx) => ctx.db.get(s.packId));

  expect(pack?.status).toBe("expired");
  expect(pack?.refundClosedAt).toBeTypeOf("number");
  expect(second.alreadyClosed).toBe(true);
  expect(instructor?.groupInventory).toBe(1);
});
