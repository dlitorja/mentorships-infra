/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// Admin refund authorization
//
// `payments.adminProcessRefund` used to check only that the caller was
// signed in, so any authenticated user could mark a payment refunded and
// flip the order to `refunded`. It also skipped the over-refund cap that
// `adminProcessRefundInternal` enforced. Both now share the same gate and
// body; these tests pin the public mutation's behavior.
// ---------------------------------------------------------------------------

type Seed = {
  adminSubject: string;
  studentSubject: string;
  paymentId: string;
  orderId: string;
};

async function seed(ctx: any, amount = "100.00"): Promise<Seed> {
  const adminSubject = "user_admin_refund";
  const studentSubject = "user_student_refund";

  await ctx.db.insert("users", {
    userId: adminSubject,
    clerkId: adminSubject,
    email: "admin-refund@example.com",
    role: "admin",
  });
  await ctx.db.insert("users", {
    userId: studentSubject,
    clerkId: studentSubject,
    email: "student-refund@example.com",
    role: "student",
  });

  const orderId = await ctx.db.insert("orders", {
    userId: studentSubject,
    status: "paid",
    provider: "stripe",
    totalAmount: amount,
    currency: "usd",
  });

  const paymentId = await ctx.db.insert("payments", {
    orderId,
    provider: "stripe",
    providerPaymentId: "pi_refund_test",
    amount,
    currency: "usd",
    status: "completed",
  });

  return { adminSubject, studentSubject, paymentId, orderId };
}

test("adminProcessRefund: rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await expect(
    t.mutation(api.payments.adminProcessRefund, {
      paymentId: seedData.paymentId as any,
      refundAmount: "100.00",
    }),
  ).rejects.toThrow("Unauthorized");
});

test("adminProcessRefund: rejects an authenticated non-admin", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await expect(
    t
      .withIdentity({ subject: seedData.studentSubject })
      .mutation(api.payments.adminProcessRefund, {
        paymentId: seedData.paymentId as any,
        refundAmount: "100.00",
      }),
  ).rejects.toThrow("Forbidden");

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.status).toBe("completed");
  expect(payment?.refundedAmount).toBeUndefined();

  const order = await t.run((ctx) => ctx.db.get(seedData.orderId as any));
  expect(order?.status).toBe("paid");
});

test("adminProcessRefund: admin can record a partial refund", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await t
    .withIdentity({ subject: seedData.adminSubject })
    .mutation(api.payments.adminProcessRefund, {
      paymentId: seedData.paymentId as any,
      refundAmount: "25.00",
    });

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.status).toBe("completed");
  expect(payment?.refundedAmount).toBe("25.00");

  const order = await t.run((ctx) => ctx.db.get(seedData.orderId as any));
  expect(order?.status).toBe("paid");
});

test("adminProcessRefund: admin full refund flips payment and order to refunded", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await t
    .withIdentity({ subject: seedData.adminSubject })
    .mutation(api.payments.adminProcessRefund, {
      paymentId: seedData.paymentId as any,
      refundAmount: "100.00",
    });

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.status).toBe("refunded");
  expect(payment?.refundedAmount).toBe("100.00");

  const order = await t.run((ctx) => ctx.db.get(seedData.orderId as any));
  expect(order?.status).toBe("refunded");
});

test("adminProcessRefund: rejects a refund that exceeds the original amount", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await expect(
    t
      .withIdentity({ subject: seedData.adminSubject })
      .mutation(api.payments.adminProcessRefund, {
        paymentId: seedData.paymentId as any,
        refundAmount: "150.00",
      }),
  ).rejects.toThrow("exceed original amount");

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.status).toBe("completed");
  expect(payment?.refundedAmount).toBeUndefined();
});

test("adminProcessRefund: rejects a second refund that pushes past the original amount", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await t
    .withIdentity({ subject: seedData.adminSubject })
    .mutation(api.payments.adminProcessRefund, {
      paymentId: seedData.paymentId as any,
      refundAmount: "60.00",
    });

  await expect(
    t
      .withIdentity({ subject: seedData.adminSubject })
      .mutation(api.payments.adminProcessRefund, {
        paymentId: seedData.paymentId as any,
        refundAmount: "60.00",
      }),
  ).rejects.toThrow("exceed original amount");

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.refundedAmount).toBe("60.00");
});

test("adminProcessRefund: rejects a non-numeric amount", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await expect(
    t
      .withIdentity({ subject: seedData.adminSubject })
      .mutation(api.payments.adminProcessRefund, {
        paymentId: seedData.paymentId as any,
        refundAmount: "not-a-number",
      }),
  ).rejects.toThrow("Invalid refund amount");

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.refundedAmount).toBeUndefined();
});

test("adminProcessRefundInternal: still admin-gated", async () => {
  const t = convexTest(schema, modules);
  const seedData = await t.run((ctx) => seed(ctx));

  await expect(
    t
      .withIdentity({ subject: seedData.studentSubject })
      .mutation(internal.payments.adminProcessRefundInternal, {
        paymentId: seedData.paymentId as any,
        refundAmount: "10.00",
      }),
  ).rejects.toThrow("Forbidden");

  await t
    .withIdentity({ subject: seedData.adminSubject })
    .mutation(internal.payments.adminProcessRefundInternal, {
      paymentId: seedData.paymentId as any,
      refundAmount: "10.00",
    });

  const payment = await t.run((ctx) => ctx.db.get(seedData.paymentId as any));
  expect(payment?.refundedAmount).toBe("10.00");
});
