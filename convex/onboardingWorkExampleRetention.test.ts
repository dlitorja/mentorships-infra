/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { ONBOARDING_WORK_EXAMPLE_RETENTION_MS } from "./workspaceConstants";

const modules = import.meta.glob("./**/*.ts");

const NOW = Date.UTC(2026, 6, 1);
const OLD = NOW - ONBOARDING_WORK_EXAMPLE_RETENTION_MS - 24 * 60 * 60 * 1000;
const RECENT = NOW - 24 * 60 * 60 * 1000;

async function seedOnboarding(t: ReturnType<typeof convexTest>): Promise<string> {
  return await t.run(async (ctx) =>
    ctx.db.insert("adminOnboardings", {
      email: "student@example.com",
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status: "processing",
      attemptCount: 1,
      assignedStudentClerkId: "user_student",
      perInstructor: [],
      timeline: [],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      createdAt: NOW,
    })
  );
}

async function insertWorkExample(
  t: ReturnType<typeof convexTest>,
  args: {
    onboardingId: string;
    status: "pending" | "active" | "deleted";
    uploadedAt: number;
    fileName: string;
    /** Set when the B2 object was already removed. */
    artifactDeletedAt?: number;
  }
): Promise<string> {
  return await t.run(async (ctx) =>
    ctx.db.insert("onboardingWorkExamples", {
      onboardingId: args.onboardingId as any,
      studentClerkId: "user_student",
      b2Key: `onboarding/${args.onboardingId}/file/${args.fileName}`,
      fileName: args.fileName,
      contentType: "image/png",
      size: 1024,
      status: args.status,
      uploadedAt: args.uploadedAt,
      deletedAt: args.status === "deleted" ? OLD : undefined,
      artifactDeletedAt: args.artifactDeletedAt,
      fileId: `file-${args.fileName}`,
    })
  );
}

test("listExpiredWorkExamples returns only live rows older than six months", async () => {
  const t = convexTest(schema, modules);
  const onboardingId = await seedOnboarding(t);

  const oldActive = await insertWorkExample(t, {
    onboardingId,
    status: "active",
    uploadedAt: OLD,
    fileName: "old-active.png",
  });
  const oldPending = await insertWorkExample(t, {
    onboardingId,
    status: "pending",
    uploadedAt: OLD + 1_000,
    fileName: "old-pending.png",
  });
  await insertWorkExample(t, {
    onboardingId,
    status: "active",
    uploadedAt: RECENT,
    fileName: "recent.png",
  });
  // Soft-deleted but the object was already removed and stamped: the
  // sweep must not list it again.
  await insertWorkExample(t, {
    onboardingId,
    status: "deleted",
    uploadedAt: OLD,
    fileName: "already-cleaned.png",
    artifactDeletedAt: OLD,
  });
  // Cancellation soft-deletes the row but leaves the object in B2; the
  // retention sweep still owns it.
  const softDeleted = await insertWorkExample(t, {
    onboardingId,
    status: "deleted",
    uploadedAt: OLD + 2_000,
    fileName: "soft-deleted-not-cleaned.png",
  });

  const rows = await t.query(internal.onboardingWorkExamples.listExpiredWorkExamples, {
    now: NOW,
    limit: 10,
  });

  expect(rows.map((row) => row._id)).toEqual([oldActive, oldPending, softDeleted]);
  // Oldest first.
  expect(rows[0].uploadedAt).toBeLessThanOrEqual(rows[1].uploadedAt);
  expect(rows[1].uploadedAt).toBeLessThanOrEqual(rows[2].uploadedAt);
});

test("markWorkExamplesExpired marks rows deleted and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const onboardingId = await seedOnboarding(t);

  const active = await insertWorkExample(t, {
    onboardingId,
    status: "active",
    uploadedAt: OLD,
    fileName: "expire-me.png",
  });

  const marked = await t.mutation(
    internal.onboardingWorkExamples.markWorkExamplesExpired,
    { workExampleIds: [active as any], now: NOW }
  );
  expect(marked).toBe(1);

  const row = await t.run(async (ctx) => ctx.db.get(active as any));
  expect(row?.status).toBe("deleted");
  expect(row?.deletedAt).toBe(NOW);
  expect(row?.artifactDeletedAt).toBe(NOW);

  // A retried batch (task already deleted the object) is a no-op.
  const again = await t.mutation(
    internal.onboardingWorkExamples.markWorkExamplesExpired,
    { workExampleIds: [active as any], now: NOW + 1_000 }
  );
  expect(again).toBe(0);

  // Once deleted, the row is no longer part of the sweep.
  const remaining = await t.query(
    internal.onboardingWorkExamples.listExpiredWorkExamples,
    { now: NOW, limit: 10 }
  );
  expect(remaining).toEqual([]);
});
