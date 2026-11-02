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
