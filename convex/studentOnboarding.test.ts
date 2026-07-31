/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const STUDENT_ID = "user_student";
const INSTRUCTOR_USER_ID = "user_instructor";
const OTHER_USER_ID = "user_other";

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
      userId: INSTRUCTOR_USER_ID,
    });
    userId = await ctx.db.insert("users", {
      userId: STUDENT_ID,
      email: "student@example.com",
      clerkId: "clerk_student",
    });
    sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: STUDENT_ID,
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

async function recordUpload(
  t: ReturnType<typeof convexTest>,
  legacyId: string,
  storageIds: string[]
): Promise<void> {
  await t.withIdentity({ subject: STUDENT_ID }).mutation(
    api.studentOnboarding.recordUpload,
    { legacyId, storageIds: storageIds as any }
  );
}

/**
 * Creates a submission with a recorded upload and the given storage IDs.
 */
async function createSubmission(
  t: ReturnType<typeof convexTest>,
  legacyId: string,
  instructorId: string,
  storageIds: string[] = []
) {
  if (storageIds.length > 0) {
    await recordUpload(t, legacyId, storageIds);
  }
  return await t.withIdentity({ subject: STUDENT_ID }).mutation(
    api.studentOnboarding.create,
    {
      legacyId,
      userId: STUDENT_ID,
      instructorId: instructorId as any,
      sessionPackId: "legacy-sp-001",
      goals: "I want to learn art",
      imageStorageIds: storageIds as any,
    }
  );
}

test("create stores imageStorageIds and listByInstructor returns them", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);

  await createSubmission(t, "sub-001", instructorId, storageIds);

  const submissions = await t.withIdentity({ subject: INSTRUCTOR_USER_ID }).query(
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

  const first = await createSubmission(t, "sub-002", instructorId);
  const second = await createSubmission(t, "sub-002", instructorId);

  expect(first.id).toBe(second.id);
  expect(first.legacyId).toBe("sub-002");

  const submissions = await t.withIdentity({ subject: INSTRUCTOR_USER_ID }).query(
    api.studentOnboarding.listByInstructor,
    { instructorId: instructorId as any }
  );
  expect(submissions).toHaveLength(1);
  expect(submissions[0].goals).toBe("I want to learn art");
});

test("create rejects mismatched userId", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);

  await expect(
    t.withIdentity({ subject: OTHER_USER_ID }).mutation(
      api.studentOnboarding.create,
      {
        legacyId: "sub-bad-user",
        userId: STUDENT_ID,
        instructorId: instructorId as any,
        sessionPackId: "legacy-sp-001",
        goals: "Goals",
      }
    )
  ).rejects.toThrow("Forbidden");
});

test("create rejects unrecorded storageIds", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);

  await expect(
    t.withIdentity({ subject: STUDENT_ID }).mutation(
      api.studentOnboarding.create,
      {
        legacyId: "sub-bad-storage",
        userId: STUDENT_ID,
        instructorId: instructorId as any,
        sessionPackId: "legacy-sp-001",
        goals: "Goals",
        imageStorageIds: storageIds as any,
      }
    )
  ).rejects.toThrow("Invalid storageIds");
});

test("listByInstructor forbids non-instructor users", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);

  await expect(
    t.withIdentity({ subject: OTHER_USER_ID }).query(
      api.studentOnboarding.listByInstructor,
      { instructorId: instructorId as any }
    )
  ).rejects.toThrow("Forbidden");
});

test("recordUpload and verifyUpload enforce ownership", async () => {
  const t = convexTest(schema, modules);
  await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);

  await t.withIdentity({ subject: STUDENT_ID }).mutation(
    api.studentOnboarding.recordUpload,
    { legacyId: "sub-record", storageIds: storageIds as any }
  );

  const verification = await t.withIdentity({ subject: STUDENT_ID }).query(
    api.studentOnboarding.verifyUpload,
    { legacyId: "sub-record", storageIds: storageIds as any }
  );
  expect(verification.valid).toBe(true);

  // Another user cannot verify the same upload.
  const other = await t.withIdentity({ subject: OTHER_USER_ID }).query(
    api.studentOnboarding.verifyUpload,
    { legacyId: "sub-record", storageIds: storageIds as any }
  );
  expect(other.valid).toBe(false);
});

test("getSignedUrls requires authentication and ownership", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);
  const { id: submissionId } = await createSubmission(t, "sub-003", instructorId, storageIds);

  await expect(
    t.query(api.studentOnboarding.getSignedUrls, { submissionId: submissionId as any })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t.withIdentity({ subject: OTHER_USER_ID }).query(
      api.studentOnboarding.getSignedUrls,
      { submissionId: submissionId as any }
    )
  ).rejects.toThrow("Forbidden");

  const byInstructor = await t.withIdentity({ subject: INSTRUCTOR_USER_ID }).query(
    api.studentOnboarding.getSignedUrls,
    { submissionId: submissionId as any }
  );
  expect(byInstructor).toHaveLength(2);

  const byStudent = await t.withIdentity({ subject: STUDENT_ID }).query(
    api.studentOnboarding.getSignedUrls,
    { submissionId: submissionId as any }
  );
  expect(byStudent).toHaveLength(2);
});

test("getSignedUrlsByLegacyId requires authentication and ownership", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  const storageIds = await createStorageIds(t, 2);
  await createSubmission(t, "sub-legacy", instructorId, storageIds);

  await expect(
    t.query(api.studentOnboarding.getSignedUrlsByLegacyId, { legacyId: "sub-legacy" })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t.withIdentity({ subject: OTHER_USER_ID }).query(
      api.studentOnboarding.getSignedUrlsByLegacyId,
      { legacyId: "sub-legacy" }
    )
  ).rejects.toThrow("Forbidden");

  const urls = await t.withIdentity({ subject: INSTRUCTOR_USER_ID }).query(
    api.studentOnboarding.getSignedUrlsByLegacyId,
    { legacyId: "sub-legacy" }
  );
  expect(urls).toHaveLength(2);
});

test("getSignedUrlsByStorageIds requires authentication", async () => {
  const t = convexTest(schema, modules);
  const storageIds = await createStorageIds(t, 2);

  await expect(
    t.query(api.studentOnboarding.getSignedUrlsByStorageIds, { storageIds: storageIds as any })
  ).rejects.toThrow("Unauthorized");

  const urls = await t.withIdentity({ subject: STUDENT_ID }).query(
    api.studentOnboarding.getSignedUrlsByStorageIds,
    { storageIds: storageIds as any }
  );
  expect(urls).toHaveLength(2);
});

test("deleteStorageObjects requires authentication and removes files", async () => {
  const t = convexTest(schema, modules);
  const storageIds = await createStorageIds(t, 2);

  await expect(
    t.action(api.studentOnboarding.deleteStorageObjects, { storageIds: storageIds as any })
  ).rejects.toThrow("Unauthorized");

  await t.withIdentity({ subject: STUDENT_ID }).action(
    api.studentOnboarding.deleteStorageObjects,
    { storageIds: storageIds as any }
  );

  const remaining = await t.withIdentity({ subject: STUDENT_ID }).query(
    api.studentOnboarding.getSignedUrlsByStorageIds,
    { storageIds: storageIds as any }
  );
  expect(remaining).toHaveLength(0);
});

test("markReviewed records reviewedAt", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await seedInstructorAndSessionPack(t);
  await createSubmission(t, "sub-004", instructorId);

  const result = await t.mutation(api.studentOnboarding.markReviewed, {
    legacyId: "sub-004",
    instructorId: instructorId as any,
    reviewedByUserId: INSTRUCTOR_USER_ID,
  });

  expect(result.ok).toBe(true);

  const submissions = await t.withIdentity({ subject: INSTRUCTOR_USER_ID }).query(
    api.studentOnboarding.listByInstructor,
    { instructorId: instructorId as any }
  );
  expect(submissions[0].reviewedAt).toBeDefined();
});

test("generateImageUploadUrl requires authentication", async () => {
  const t = convexTest(schema, modules);
  await expect(t.action(api.studentOnboarding.generateImageUploadUrl, {})).rejects.toThrow(
    "Unauthorized"
  );

  const url = await t.withIdentity({ subject: STUDENT_ID }).action(
    api.studentOnboarding.generateImageUploadUrl,
    {}
  );
  expect(typeof url).toBe("string");
  expect(url.length).toBeGreaterThan(0);
});
