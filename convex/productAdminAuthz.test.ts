/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// getProductForAdmin authorization
//
// The query previously checked only that the caller was signed in. The
// admin product routes already gate on the admin role; this pins the
// backend gate so the query can't be used by any signed-in user.
// ---------------------------------------------------------------------------

const ADMIN = "user_admin_product";
const STUDENT = "user_student_product";

async function seed(ctx: any) {
  await ctx.db.insert("users", {
    userId: ADMIN,
    clerkId: ADMIN,
    email: "admin-product@example.com",
    role: "admin",
  });
  await ctx.db.insert("users", {
    userId: STUDENT,
    clerkId: STUDENT,
    email: "student-product@example.com",
    role: "student",
  });
  const instructorId = await ctx.db.insert("instructors", {
    userId: "user_instructor_product",
    name: "Product Instructor",
    isActive: true,
  });
  const productId = await ctx.db.insert("products", {
    instructorId,
    title: "One-on-one pack",
    price: "100.00",
    currency: "usd",
    sessionsPerPack: 4,
    validityDays: 30,
    mentorshipType: "one-on-one",
    active: true,
  });
  return { instructorId, productId };
}

test("getProductForAdmin: rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { productId } = await t.run((ctx) => seed(ctx));

  await expect(
    t.query(api.products.getProductForAdmin, { id: productId }),
  ).rejects.toThrow("Unauthorized");
});

test("getProductForAdmin: rejects an authenticated non-admin", async () => {
  const t = convexTest(schema, modules);
  const { productId } = await t.run((ctx) => seed(ctx));

  await expect(
    t
      .withIdentity({ subject: STUDENT })
      .query(api.products.getProductForAdmin, { id: productId }),
  ).rejects.toThrow("Forbidden");
});

test("getProductForAdmin: returns the product for an admin", async () => {
  const t = convexTest(schema, modules);
  const { productId } = await t.run((ctx) => seed(ctx));

  const product = await t
    .withIdentity({ subject: ADMIN })
    .query(api.products.getProductForAdmin, { id: productId });

  expect(product).not.toBeNull();
  expect(product?.title).toBe("One-on-one pack");
  expect(product?.instructorName).toBe("Product Instructor");
});

test("getProductForAdmin: returns null for a missing product when admin", async () => {
  const t = convexTest(schema, modules);
  const { productId } = await t.run((ctx) => seed(ctx));
  await t.run((ctx) => ctx.db.delete(productId));

  const product = await t
    .withIdentity({ subject: ADMIN })
    .query(api.products.getProductForAdmin, { id: productId });

  expect(product).toBeNull();
});
