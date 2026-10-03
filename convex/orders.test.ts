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
