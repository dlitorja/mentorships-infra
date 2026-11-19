/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NEIL = {
  name: "Neil Gray",
  slug: "neil-gray",
  email: "nrcgray@gmail.com",
  isActive: true,
  isNew: false,
  oneOnOneInventory: 3,
  groupInventory: 0,
  maxActiveStudents: 10,
};

test("onboardKajabiPurchase commits one enrollment and is idempotent on the purchase id", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("instructors", NEIL);
  });

  const first = await t.mutation(
    internal.adminOnboarding.onboardKajabiPurchase,
    {
      email: "buyer@example.com",
      studentName: "Guy Maron",
      instructorSlug: "neil-gray",
      externalPurchaseId: "kajabi:purchase:test-1",
    }
  );

  expect(first.alreadyExists).toBe(false);
  expect(first.status).toBe("processing");
  expect(first.attemptCount).toBe(1);

  const row = await t.run(
    async (ctx) => await ctx.db.get(first.onboardingId as never)
  );
  expect(row?.source).toBe("kajabi");
  expect(row?.submittedByUserId).toBe("kajabi-webhook");
  expect(row?.externalPurchaseId).toBe("kajabi:purchase:test-1");
  expect(row?.studentName).toBe("Guy Maron");
  expect(row?.perInstructor).toHaveLength(1);
  expect(row?.perInstructor[0].sessionsPerInstructor).toBe(4);
  expect(row?.perInstructor[0].expiresAt).toBeGreaterThan(Date.now());

  const packs = await t.run(
    async (ctx) => await ctx.db.query("sessionPacks").collect()
  );
  const seats = await t.run(
    async (ctx) => await ctx.db.query("seatReservations").collect()
  );
  const workspaces = await t.run(
    async (ctx) => await ctx.db.query("workspaces").collect()
  );
  expect(packs).toHaveLength(1);
  expect(packs[0].totalSessions).toBe(4);
  expect(packs[0].userId).toBe("email:buyer@example.com");
  expect(seats).toHaveLength(1);
  expect(seats[0].userId).toBe("email:buyer@example.com");
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0].name).toContain("Neil Gray");

  const second = await t.mutation(
    internal.adminOnboarding.onboardKajabiPurchase,
    {
      email: "buyer@example.com",
      studentName: "Guy Maron",
      instructorSlug: "neil-gray",
      externalPurchaseId: "kajabi:purchase:test-1",
    }
  );
  expect(second.alreadyExists).toBe(true);
  expect(second.onboardingId).toBe(first.onboardingId);

  const rows = await t.run(
    async (ctx) => await ctx.db.query("adminOnboardings").collect()
  );
  expect(rows).toHaveLength(1);
});

test("onboardKajabiPurchase rejects an unknown instructor slug", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("instructors", NEIL);
  });

  await expect(
    t.mutation(internal.adminOnboarding.onboardKajabiPurchase, {
      email: "buyer@example.com",
      instructorSlug: "does-not-exist",
      externalPurchaseId: "kajabi:purchase:test-2",
    })
  ).rejects.toThrow(/Active instructor not found/);
});
