/**
 * Seed the `test-instructor-waitlist` fixture consumed by
 * `tests/e2e/waitlist.spec.ts` (Kernel-backed Playwright project).
 *
 * Idempotent: upserts the fixture row in both `instructorProfiles`
 * and `instructors`. Safe to run repeatedly. The Convex mutation
 * enforces a `test-` slug prefix + `isTestFixture` check so this
 * script can never overwrite a real instructor row.
 *
 * Usage (from repo root):
 *   set -a
 *   source apps/platform/.env.local
 *   set +a
 *   pnpm exec tsx apps/platform/scripts/seed-test-instructors.mts
 *
 * Required env vars:
 *   - CONVEX_URL or NEXT_PUBLIC_CONVEX_URL (the seed script targets
 *     the deployment whose URL you provide; pick a non-prod deployment
 *     so test runs never write to production data).
 *   - CONVEX_HTTP_KEY (shared bearer secret for `/internal/*` HTTP
 *     actions; matches `verifyAuth` in `convex/http.ts`).
 */

import { convexServerCall } from "../lib/convex-server-call";

type SeedResult = {
  profileId: string;
  instructorId: string;
  slug: string;
};

const FIXTURE = {
  slug: "test-instructor-waitlist",
  name: "Test Instructor",
  bio: "TEST INSTRUCTOR - Hidden for waitlist testing",
  tagline: "Hidden for waitlist testing",
  oneOnOneInventory: 0,
  groupInventory: 0,
} as const;

async function main(): Promise<void> {
  const target =
    process.env.CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    "";
  if (!target) {
    throw new Error(
      "CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set. " +
        "Pick the Convex deployment you want to seed and export its URL."
    );
  }
  if (!process.env.CONVEX_HTTP_KEY) {
    throw new Error("CONVEX_HTTP_KEY is not set; cannot authenticate seed call.");
  }

  console.log(`Seeding fixture into ${target.replace(/\/+$/, "")}`);
  console.log(`  slug=${FIXTURE.slug}`);
  console.log(`  name=${FIXTURE.name}`);
  console.log(`  oneOnOneInventory=${FIXTURE.oneOnOneInventory}`);
  console.log(`  groupInventory=${FIXTURE.groupInventory}`);

  const result = await convexServerCall<SeedResult>(
    "/internal/upsert-test-fixture-instructor",
    FIXTURE
  );

  console.log("");
  console.log("Seeded:");
  console.log(`  profileId     = ${result.profileId}`);
  console.log(`  instructorId  = ${result.instructorId}`);
  console.log(`  slug          = ${result.slug}`);
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
