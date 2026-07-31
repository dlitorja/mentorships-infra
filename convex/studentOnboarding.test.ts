/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedInstructorAndSessionPack(
  t: ReturnType<typeof convexTest>
): Promise<{ instructorId: string; sessionPackId: string; userId: string }> {
  let instructorId = "";
  let sessionPackId = "";
  let userId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      name: "Test Instructor",
      slug: "test-instructor",
      email: "instructor@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
      userId: "user_instructor",
    });
    userId = await ctx.db.insert("users", {
      userId: "user_student",
      email: "student@example.com",
      clerkId: "clerk_student",
    });
    sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student",
      instructorId: instructorId as any,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
      legacyId: "legacy-sp-001",
    });
  });
  return { instructorId, sessionPackId, userId };
}

async function createStorageIds(
  t: ReturnType<typeof convexTest>,
  count: number
): Promise<string[]> {
  const ids: string[] = [];
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const blob = new Blob(["test-image-" + i], { type: "image/png" });
      const id = await ctx.storage.store(blob);
      ids.push(id);
    }
  });
  return ids;
}

test("create stores imageStorageIds and listByInstructor returns them", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);

  await t.mutation(api.studentOnboarding.create, {
    legacyId: "sub-001",
    userId: "user_student",
    instructorId: instructorId as any,
    sessionPackId: "legacy-sp-001",
    goals: "I want to learn art",
    imageStorageIds: storageIds as any,
  });

  const submissions = await t.withIdentity({ subject: "user_instructor" }).query(
    api.studentOnboarding.listByInstructor,
    { instructorId: instructorId as any }
  );

  expect(submissions).toHaveLength(1);
  expect(submissions[0].goals).toBe("I want to learn art");
  expect(submissions[0].imageStorageIds).toEqual(storageIds);
  expect(submissions[0].studentEmail).toBe("student@example.com");
});

test("create is idempotent", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);

  const first = await t.mutation(api.studentOnboarding.create, {
    legacyId: "sub-002",
    userId: "user_student",
    instructorId: instructorId as any,
    sessionPackId: "legacy-sp-001",
    goals: "First",
  });

  const second = await t.mutation(api.studentOnboarding.create, {
    legacyId: "sub-002",
    userId: "user_student",
    instructorId: instructorId as any,
    sessionPackId: "legacy-sp-001",
    goals: "Second",
  });

  expect(first.id).toBe(second.id);
  expect(first.legacyId).toBe("sub-002");

  const submissions = await t.withIdentity({ subject: "user_instructor" }).query(
    api.studentOnboarding.listByInstructor,
    { instructorId: instructorId as any }
  );
  expect(submissions).toHaveLength(1);
  expect(submissions[0].goals).toBe("First");
});

test("listByInstructor forbids non-instructor users", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);

  await expect(
    t.withIdentity({ subject: "user_other" }).query(
      api.studentOnboarding.listByInstructor,
      { instructorId: instructorId as any }
    )
  ).rejects.toThrow("Forbidden");
});

test("getSignedUrls and getSignedUrlsByStorageIds require storageIds", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);

  const { id: submissionId } = await t.mutation(api.studentOnboarding.create, {
    legacyId: "sub-003",
    userId: "user_student",
    instructorId: instructorId as any,
    sessionPackId: "legacy-sp-001",
    goals: "Goals",
    imageStorageIds: storageIds as any,
  });

  const bySubmission = await t.query(api.studentOnboarding.getSignedUrls, {
    submissionId: submissionId as any,
  });
  expect(bySubmission).toHaveLength(2);
  expect(bySubmission[0].storageId).toBe(storageIds[0]);
  expect(bySubmission[0].signedUrl).toBeDefined();

  const byIds = await t.query(api.studentOnboarding.getSignedUrlsByStorageIds, {
    storageIds: storageIds as any,
  });
  expect(byIds).toHaveLength(2);
});

test("markReviewed records reviewedAt", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);

  await t.mutation(api.studentOnboarding.create, {
    legacyId: "sub-004",
    userId: "user_student",
    instructorId: instructorId as any,
    sessionPackId: "legacy-sp-001",
    goals: "Goals",
  });

  const result = await t.mutation(api.studentOnboarding.markReviewed, {
    legacyId: "sub-004",
    instructorId: instructorId as any,
    reviewedByUserId: "user_instructor",
  });

  expect(result.ok).toBe(true);

  const submissions = await t.withIdentity({ subject: "user_instructor" }).query(
    api.studentOnboarding.listByInstructor,
    { instructorId: instructorId as any }
  );
  expect(submissions[0].reviewedAt).toBeDefined();
});

test("generateImageUploadUrl returns a string URL", async () => {
  const t = convexTest(schema, modules);
  const url = await t.action(api.studentOnboarding.generateImageUploadUrl, {});
  expect(typeof url).toBe("string");
  expect(url.length).toBeGreaterThan(0);
});
