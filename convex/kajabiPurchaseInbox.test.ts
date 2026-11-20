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

test("upsertFromEmail keeps a conflicting purchase-id claim instead of dropping it", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.kajabiPurchaseInbox.upsertFromEmail, {
    ...base,
    resendEmailId: "email-conflict-1",
    kajabiPurchaseId: "purchase-conflict",
  });

  const second = await t.mutation(
    internal.kajabiPurchaseInbox.upsertFromEmail,
    {
      ...base,
      resendEmailId: "email-conflict-2",
      fromAddress: "someone-else@example.com",
      studentEmail: "different@example.com",
      kajabiPurchaseId: "purchase-conflict",
    }
  );

  // The second message is kept, not silently discarded: the inbox accepts
  // mail from anyone, so the first claim is not proof of authenticity.
  expect(second.inserted).toBe(true);
  const rows = await t.run(
    async (ctx) => await ctx.db.query("kajabiPurchaseInbox").collect()
  );
  expect(rows).toHaveLength(2);
  const conflict = rows.find((row) => row.resendEmailId === "email-conflict-2");
  expect(conflict?.conflictWith).toBe(first.purchaseId);
});

test("approveKajabiPurchase refuses a conflict until the other claim is dismissed", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { instructorId, approvedId, conflictId } = await t.run(async (ctx) => {
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
    const insert = (resendEmailId: string) =>
      ctx.db.insert("kajabiPurchaseInbox", {
        resendEmailId,
        fromAddress: "support@kajabi.com",
        subject: "Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '",
        receivedAt: now,
        offerTitle: "Neil Gray - (1-on-1) Mentorship",
        purchaseType: "one-on-one",
        instructorName: "Neil Gray",
        studentName: "Test Student",
        studentEmail: "student@example.com",
        kajabiPurchaseId: "purchase-conflict-approve",
        rawText: "Name: Test Student\nEmail: student@example.com",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    const approvedId = await insert("conflict-approve-1");
    const conflictId = await ctx.db.insert("kajabiPurchaseInbox", {
      resendEmailId: "conflict-approve-2",
      fromAddress: "someone-else@example.com",
      subject: "Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '",
      receivedAt: now,
      offerTitle: "Neil Gray - (1-on-1) Mentorship",
      purchaseType: "one-on-one",
      instructorName: "Neil Gray",
      studentName: "Test Student",
      studentEmail: "student@example.com",
      kajabiPurchaseId: "purchase-conflict-approve",
      conflictWith: approvedId,
      rawText: "Name: Test Student\nEmail: student@example.com",
      status: "pending",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    return { instructorId, approvedId, conflictId };
  });

  const admin = t.withIdentity({
    subject: "user_admin",
    email: "admin@example.com",
  });
  const args = {
    instructorId,
    sessionsPerInstructor: 4,
    expiresAt: now + 90 * 24 * 60 * 60 * 1000,
  };

  await expect(
    admin.mutation(api.adminOnboarding.approveKajabiPurchase, {
      ...args,
      purchaseId: conflictId,
    })
  ).rejects.toThrow(/same purchase id/i);

  // Dismiss the first claim, then the genuine confirmation can commit.
  await admin.mutation(api.kajabiPurchaseInbox.dismissPurchase, {
    id: approvedId,
    reason: "duplicate claim",
  });
  const result = await admin.mutation(api.adminOnboarding.approveKajabiPurchase, {
    ...args,
    purchaseId: conflictId,
  });
  expect(result.alreadyApproved).toBe(false);

  // A second approval for the same purchase id is refused.
  const thirdId = await t.run(async (ctx) =>
    ctx.db.insert("kajabiPurchaseInbox", {
      resendEmailId: "conflict-approve-3",
      fromAddress: "support@kajabi.com",
      subject: "Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '",
      receivedAt: now + 2,
      offerTitle: "Neil Gray - (1-on-1) Mentorship",
      purchaseType: "one-on-one",
      instructorName: "Neil Gray",
      studentName: "Test Student",
      studentEmail: "student@example.com",
      kajabiPurchaseId: "purchase-conflict-approve",
      rawText: "Name: Test Student\nEmail: student@example.com",
      status: "pending",
      createdAt: now + 2,
      updatedAt: now + 2,
    })
  );
  await expect(
    admin.mutation(api.adminOnboarding.approveKajabiPurchase, {
      ...args,
      purchaseId: thirdId,
    })
  ).rejects.toThrow(/already approved from another confirmation/i);
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
