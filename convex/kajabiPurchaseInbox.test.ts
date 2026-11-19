/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const base = {
  fromAddress: "support@kajabi.com",
  subject: "Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '",
  receivedAt: Date.now(),
  offerTitle: "Neil Gray - (1-on-1) Mentorship",
  purchaseType: "one-on-one" as const,
  instructorName: "Neil Gray",
  studentName: "Test Student",
  studentEmail: "student@example.com",
  rawText: "Name: Test Student\nEmail: student@example.com\nPurchase ID: 123456789",
};

test("upsertFromEmail dedupes on the Resend email id", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(
    internal.kajabiPurchaseInbox.upsertFromEmail,
    { ...base, resendEmailId: "email-1", kajabiPurchaseId: "purchase-1" }
  );
  const second = await t.mutation(
    internal.kajabiPurchaseInbox.upsertFromEmail,
    { ...base, resendEmailId: "email-1", kajabiPurchaseId: "purchase-1" }
  );

  expect(first.inserted).toBe(true);
  expect(second.inserted).toBe(false);
  const rows = await t.run(
    async (ctx) => await ctx.db.query("kajabiPurchaseInbox").collect()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("pending");
});

test("upsertFromEmail dedupes on the Kajabi purchase id across different emails", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.kajabiPurchaseInbox.upsertFromEmail, {
    ...base,
    resendEmailId: "email-2",
    kajabiPurchaseId: "purchase-2",
  });
  const second = await t.mutation(
    internal.kajabiPurchaseInbox.upsertFromEmail,
    {
      ...base,
      resendEmailId: "email-3",
      kajabiPurchaseId: "purchase-2",
    }
  );

  expect(second.inserted).toBe(false);
  const rows = await t.run(
    async (ctx) => await ctx.db.query("kajabiPurchaseInbox").collect()
  );
  expect(rows).toHaveLength(1);
});

test("approveKajabiPurchase commits and marks the purchase approved", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { purchaseId, instructorId } = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      name: "Neil Gray",
      slug: "neil-gray",
      email: "nrcgray@gmail.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 3,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    await ctx.db.insert("users", {
      userId: "user_admin",
      email: "admin@example.com",
      clerkId: "user_admin",
      role: "admin",
    });
    const purchaseId = await ctx.db.insert("kajabiPurchaseInbox", {
      resendEmailId: "approve-email-1",
      fromAddress: "support@kajabi.com",
      subject: "Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '",
      receivedAt: now,
      offerTitle: "Neil Gray - (1-on-1) Mentorship",
      purchaseType: "one-on-one",
      instructorName: "Neil Gray",
      studentName: "Test Student",
      studentEmail: "student@example.com",
      kajabiPurchaseId: "approve-purchase-1",
      rawText: "Name: Test Student\nEmail: student@example.com",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { purchaseId, instructorId };
  });

  const result = await t
    .withIdentity({ subject: "user_admin", email: "admin@example.com" })
    .mutation(api.adminOnboarding.approveKajabiPurchase, {
      purchaseId,
      instructorId,
      sessionsPerInstructor: 4,
      expiresAt: now + 90 * 24 * 60 * 60 * 1000,
    });

  const purchase = await t.run(async (ctx) => await ctx.db.get(purchaseId));
  expect(purchase?.status).toBe("approved");
  expect(purchase?.onboardingId).toBe(result.onboardingId);
  expect(purchase?.approvedByUserId).toBe("user_admin");

  const onboarding = await t.run(
    async (ctx) => await ctx.db.get(result.onboardingId as never)
  );
  expect(onboarding?.status).toBe("processing");
  expect(onboarding?.email).toBe("student@example.com");
  expect(onboarding?.source).toBe("kajabi");
});
