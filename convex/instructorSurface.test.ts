/// <reference types="vite/client" />
import { expect, test } from "vitest";
import * as instructors from "./instructors";

/**
 * Wave 2a (HUC-119) regression guard — dead / script-only instructor writers
 * plus the inventory pair.
 *
 * These were public Convex mutations. The five upload/upsert/image functions
 * had no live callers (one upsert pair is only used by the one-off migration
 * script via `npx convex run`, which still works for internal functions); the
 * inventory pair is server-only and is now called through the
 * `CONVEX_HTTP_KEY`-gated `/inventory/*` endpoints.
 */

type Visibility = { isInternal?: boolean; isPublic?: boolean };

const INTERNAL_ONLY: ReadonlyArray<readonly [string, Visibility]> = [
  ["decrementInventory", instructors.decrementInventory as Visibility],
  ["incrementInventory", instructors.incrementInventory as Visibility],
  ["upsertInstructorTestimonial", instructors.upsertInstructorTestimonial as Visibility],
  ["upsertStudentResult", instructors.upsertStudentResult as Visibility],
  ["uploadStudentResultImage", instructors.uploadStudentResultImage as Visibility],
  ["updateInstructorProfileImage", instructors.updateInstructorProfileImage as Visibility],
  ["updateInstructorPortfolioImage", instructors.updateInstructorPortfolioImage as Visibility],
];

test("wave 2a instructor writers are internal-only", () => {
  for (const [functionName, visibility] of INTERNAL_ONLY) {
    expect(visibility.isInternal, `instructors.${functionName} must be internalMutation`).toBe(true);
    expect(visibility.isPublic, `instructors.${functionName} must not be public`).not.toBe(true);
  }
});

import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ADMIN = "user_admin_wave2b";
const OWNER = "user_ownerwave2b";
const SELF = "user_selfwave2b";
const OTHER = "user_other_wave2b";

async function seedWave2b(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN,
      clerkId: ADMIN,
      email: "wave2b-admin@example.com",
      role: "admin",
    });
    const ownerInstructorId = await ctx.db.insert("instructors", {
      userId: OWNER,
      name: "Owner Instructor",
      slug: "owner-wave2b",
    });
    const placeholderInstructorId = await ctx.db.insert("instructors", {
      userId: "seed-placeholder-wave2b",
      name: "Placeholder Instructor",
      slug: "placeholder-wave2b",
    });
    return { ownerInstructorId, placeholderInstructorId };
  });
}

test("createInstructor: admin or self only", async () => {
  const t = convexTest(schema, modules);
  await seedWave2b(t);

  await expect(
    t.mutation(api.instructors.createInstructor, { name: "Anonymous" })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.instructors.createInstructor, {
        userId: "user_victim_wave2b",
        name: "Victim",
      })
  ).rejects.toThrow("Forbidden");

  const selfId = await t
    .withIdentity({ subject: SELF })
    .mutation(api.instructors.createInstructor, {
      userId: SELF,
      name: "Self Provisioned",
      oneOnOneInventory: 999,
      isActive: false,
    });
  expect(selfId).toBeTruthy();

  const selfRow = await t.run(async (ctx) => ctx.db.get(selfId));
  expect(selfRow?.oneOnOneInventory).toBe(0);
  expect(selfRow?.isActive).toBe(true);

  const adminId = await t
    .withIdentity({ subject: ADMIN })
    .mutation(api.instructors.createInstructor, {
      userId: "user_created_by_admin_wave2b",
      name: "Created By Admin",
    });
  expect(adminId).toBeTruthy();
});

test("instructor image uploads: owner or admin only", async () => {
  const t = convexTest(schema, modules);
  const { ownerInstructorId, placeholderInstructorId } = await seedWave2b(t);
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["wave2b-image"]))
  );

  await expect(
    t.mutation(api.instructors.uploadInstructorProfileImage, {
      instructorId: ownerInstructorId,
      storageId,
      contentType: "image/png",
    })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.instructors.uploadInstructorProfileImage, {
        instructorId: ownerInstructorId,
        storageId,
        contentType: "image/png",
      })
  ).rejects.toThrow("Forbidden");

  await t
    .withIdentity({ subject: OWNER })
    .mutation(api.instructors.uploadInstructorProfileImage, {
      instructorId: ownerInstructorId,
      storageId,
      contentType: "image/png",
    });

  const ownerRow = await t.run(async (ctx) => ctx.db.get(ownerInstructorId));
  expect(ownerRow?.profileImageStorageId).toBe(storageId);

  // Placeholder rows are not owned by the signed-in instructor; admin can edit.
  await expect(
    t
      .withIdentity({ subject: OWNER })
      .mutation(api.instructors.uploadInstructorPortfolioImage, {
        instructorId: placeholderInstructorId,
        storageId,
        contentType: "image/png",
        index: 0,
      })
  ).rejects.toThrow("Forbidden");

  await t
    .withIdentity({ subject: ADMIN })
    .mutation(api.instructors.uploadInstructorPortfolioImage, {
      instructorId: placeholderInstructorId,
      storageId,
      contentType: "image/png",
      index: 0,
    });

  const placeholderRow = await t.run(async (ctx) =>
    ctx.db.get(placeholderInstructorId)
  );
  expect(placeholderRow?.portfolioImageStorageIds?.[0]).toBe(storageId);
});
