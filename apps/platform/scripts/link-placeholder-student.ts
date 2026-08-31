/**
 * One-off backfill for a student who signed up via the admin onboarding
 * flow but whose placeholder data was not linked to their real Clerk user
 * ID (e.g., because the Inngest `clerk/user.created` handler did not run).
 *
 * Usage (from the repo root, with production env vars loaded):
 *   set -a
 *   source apps/platform/.env.local
 *   set +a
 *   npx tsx apps/platform/scripts/link-placeholder-student.ts <clerkUserId>
 *
 * The script:
 * 1. Looks up the student in Clerk by the provided user ID to get their email.
 * 2. Calls the three Convex internal HTTP endpoints that link placeholder
 *    session packs, seat reservations, and workspaces (userId = email:<email>)
 *    to the real Clerk user ID.
 *
 * Required env vars (already set in production):
 *   - CLERK_SECRET_KEY
 *   - CONVEX_URL or NEXT_PUBLIC_CONVEX_URL
 *   - CONVEX_HTTP_KEY
 */

import { clerkClient } from "@clerk/nextjs/server";
import { convexServerCall } from "../lib/convex-server-call";

const clerkUserId = process.argv[2];

if (!clerkUserId) {
  console.error("Usage: npx tsx apps/platform/scripts/link-placeholder-student.ts <clerkUserId>");
  process.exit(1);
}

async function main(): Promise<void> {
  const clerk = await clerkClient();
  const clerkUser = await clerk.users.getUser(clerkUserId);

  const email = clerkUser.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    throw new Error(`Clerk user ${clerkUserId} has no primary email address`);
  }

  const normalizedEmail = email.toLowerCase().trim();

  console.log(`Linking placeholder data for ${clerkUserId} (${normalizedEmail})`);

  const results = await Promise.allSettled([
    convexServerCall<{ linked: number }>("/internal/link-session-packs", {
      clerkUserId,
      email: normalizedEmail,
    }),
    convexServerCall<{ linked: number }>("/internal/link-seat-reservations", {
      clerkUserId,
      email: normalizedEmail,
    }),
    convexServerCall<{ linked: number }>("/internal/link-workspaces", {
      clerkUserId,
      email: normalizedEmail,
    }),
  ]);

  const labels = ["session packs", "seat reservations", "workspaces"];

  let failed = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      console.log(`✓ ${labels[i]}: linked ${result.value.linked}`);
    } else {
      failed = true;
      console.error(`✗ ${labels[i]}: failed`);
      console.error(result.reason);
    }
  }

  if (failed) {
    console.error("\nAt least one link failed. Re-run the script after fixing the error.");
    process.exit(1);
  }

  console.log("\nAll placeholder data linked successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
