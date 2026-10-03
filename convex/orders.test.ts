/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const VALID_KEY = "test-convex-http-key";

async function seedOrder(
  t: ReturnType<typeof convexTest>,
  overrides: { status?: "pending" | "paid" | "refunded" | "failed" | "canceled" } = {},
): Promise<Id<"orders">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("orders", {
      userId: "user_test",
      provider: "stripe",
      totalAmount: "1000",
      currency: "usd",
      status: overrides.status ?? "pending",
    });
  });
}

// ---------------------------------------------------------------------------
// updateOrder: validator + terminal-state guard
// ---------------------------------------------------------------------------

test("updateOrder accepts status: 'failed' on a pending order", async () => {
  const t = convexTest(schema, modules);
  const id = await seedOrder(t, { status: "pending" });

  const updated = await t.mutation(api.orders.updateOrder, { id, status: "failed" });
  expect(updated?.status).toBe("failed");
});

test("updateOrder rejects status: 'canceled' (validator narrows to 'failed' only)", async () => {
  const t = convexTest(schema, modules);
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.updateOrder, { id, status: "canceled" }),
  ).rejects.toThrow();
});

test("updateOrder rejects status: 'paid' (validator narrows to 'failed' only)", async () => {
  const t = convexTest(schema, modules);
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.updateOrder, { id, status: "paid" }),
  ).rejects.toThrow();
});

test("updateOrder rejects status: 'pending' (validator narrows to 'failed' only)", async () => {
  const t = convexTest(schema, modules);
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.updateOrder, { id, status: "pending" }),
  ).rejects.toThrow();
});

test("updateOrder rejects writes to a paid order (terminal-state guard)", async () => {
  const t = convexTest(schema, modules);
  const id = await seedOrder(t, { status: "paid" });

  await expect(
    t.mutation(api.orders.updateOrder, { id, status: "failed" }),
  ).rejects.toThrow(/terminal state/i);
});

test("updateOrder rejects writes to a refunded order (terminal-state guard)", async () => {
  const t = convexTest(schema, modules);
  const id = await seedOrder(t, { status: "refunded" });

  await expect(
    t.mutation(api.orders.updateOrder, { id, status: "failed" }),
  ).rejects.toThrow(/terminal state/i);
});

// ---------------------------------------------------------------------------
// Service-key rejection: completeOrder / refundOrder / cancelOrder /
// deleteOrder / migrateOrder all throw without a valid service key.
// ---------------------------------------------------------------------------

test("completeOrder throws when serviceKey is missing", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.completeOrder, { id, serviceKey: "" }),
  ).rejects.toThrow(/Unauthorized/i);
});

test("completeOrder throws when serviceKey is wrong", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.completeOrder, { id, serviceKey: "wrong-key" }),
  ).rejects.toThrow(/Unauthorized/i);
});

test("completeOrder throws when CONVEX_HTTP_KEY env var is unset", async () => {
  const t = convexTest(schema, modules);
  delete process.env.CONVEX_HTTP_KEY;
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.completeOrder, { id, serviceKey: VALID_KEY }),
  ).rejects.toThrow(/CONVEX_HTTP_KEY/i);
});

test("completeOrder succeeds with the valid service key", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "pending" });

  const updated = await t.mutation(api.orders.completeOrder, {
    id,
    serviceKey: VALID_KEY,
  });
  expect(updated?.status).toBe("paid");
});

test("refundOrder throws when serviceKey is missing", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "paid" });

  await expect(
    t.mutation(api.orders.refundOrder, { id, serviceKey: "wrong-key" }),
  ).rejects.toThrow(/Unauthorized/i);
});

test("cancelOrder throws when serviceKey is missing", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "pending" });

  await expect(
    t.mutation(api.orders.cancelOrder, { id, serviceKey: "wrong-key" }),
  ).rejects.toThrow(/Unauthorized/i);
});

test("cancelOrder rejects on a paid order (state guard preserved)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "paid" });

  await expect(
    t.mutation(api.orders.cancelOrder, { id, serviceKey: VALID_KEY }),
  ).rejects.toThrow(/only "pending"/i);
});

test("cancelOrder succeeds with valid key on a pending order", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "pending" });

  const updated = await t.mutation(api.orders.cancelOrder, {
    id,
    serviceKey: VALID_KEY,
  });
  expect(updated?.status).toBe("canceled");
});

test("deleteOrder throws when serviceKey is missing", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const id = await seedOrder(t, { status: "paid" });

  await expect(
    t.mutation(api.orders.deleteOrder, { id, serviceKey: "wrong-key" }),
  ).rejects.toThrow(/Unauthorized/i);
});

test("migrateOrder throws when serviceKey is missing", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  await expect(
    t.mutation(api.orders.migrateOrder, {
      id: "legacy-id-1",
      userId: "user_legacy",
      status: "paid",
      provider: "stripe",
      totalAmount: "500",
      serviceKey: "wrong-key",
    }),
  ).rejects.toThrow(/Unauthorized/i);
});

// ---------------------------------------------------------------------------
// getOrderPublicStatus: public-facing query must only expose { status, provider }
// and nothing else (no userId / totalAmount / currency / _id / _creationTime).
// ---------------------------------------------------------------------------

test("getOrderPublicStatus returns null for a non-existent order", async () => {
  const t = convexTest(schema, modules);
  // Insert then immediately delete so we have a well-formed ID that the
  // table no longer contains. Convex's v.id() validator rejects malformed
  // IDs outright, so we can't just construct an arbitrary string.
  const id = await t.run(async (ctx) => {
    const inserted = await ctx.db.insert("orders", {
      userId: "user_test",
      provider: "stripe",
      totalAmount: "100",
      currency: "usd",
      status: "pending",
    });
    await ctx.db.delete(inserted);
    return inserted;
  });

  const result = await t.query(api.orders.getOrderPublicStatus, { id });
  expect(result).toBeNull();
});

test("getOrderPublicStatus returns only { status, provider } for an existing order", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("orders", {
      userId: "user_test",
      provider: "paypal",
      totalAmount: "9999",
      currency: "eur",
      status: "pending",
    });
  });

  const result = await t.query(api.orders.getOrderPublicStatus, { id });
  expect(result).toEqual({ status: "pending", provider: "paypal" });
});

test("getOrderPublicStatus does not leak userId, totalAmount, currency, or system fields", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("orders", {
      userId: "user_sensitive",
      provider: "stripe",
      totalAmount: "12345",
      currency: "gbp",
      status: "paid",
    });
  });

  const result = await t.query(api.orders.getOrderPublicStatus, { id });
  expect(result).not.toBeNull();
  const keys = Object.keys(result as Record<string, unknown>).sort();
  expect(keys).toEqual(["provider", "status"]);
  expect((result as Record<string, unknown>).userId).toBeUndefined();
  expect((result as Record<string, unknown>).totalAmount).toBeUndefined();
  expect((result as Record<string, unknown>).currency).toBeUndefined();
  expect((result as Record<string, unknown>)._id).toBeUndefined();
  expect((result as Record<string, unknown>)._creationTime).toBeUndefined();
});
