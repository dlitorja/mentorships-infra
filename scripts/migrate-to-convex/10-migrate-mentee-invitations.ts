/**
 * Migration Script: 10-migrate-mentee-invitations.ts
 * 
 * Migrates mentee invitations from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/10-migrate-mentee-invitations.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, menteeInvitations, instructors } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleMenteeInvitation {
  id: string;
  email: string;
  instructorId: string;
  clerkInvitationId: string | null;
  expiresAt: Date;
  status: "pending" | "accepted" | "expired" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

async function runConvexMutation(functionName: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const argsJson = JSON.stringify(args);
    const child = spawn("npx", [
      "convex",
      "run",
      functionName,
      argsJson,
      "--typecheck", "disable",
      "--deployment", CONVEX_DEPLOYMENT
    ], {
      cwd: process.cwd(),
      shell: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${functionName} failed (code ${code}): ${stderr || stdout}`));
        return;
      }

      const trimmed = stdout.trim();
      try {
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          resolve(JSON.parse(trimmed));
        } else {
          resolve({ success: true, raw: trimmed });
        }
      } catch {
        resolve({ success: true, raw: stdout });
      }
    });
  });
}

async function migrateMenteeInvitations(): Promise<void> {
  console.log("Starting mentee invitations migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching mentee invitations from Drizzle...");
  const allInvitations = await db.select().from(menteeInvitations).all();
  console.log(`Found ${allInvitations.length} mentee invitations in Drizzle`);

  console.log("Fetching instructors from Drizzle...");
  const allInstructors = await db.select().from(instructors).all();
  console.log(`Found ${allInstructors.length} instructors\n`);

  const instructorMentorIdToConvexId = new Map<string, string>();
  for (const instructor of allInstructors) {
    if (instructor.mentorId) {
      instructorMentorIdToConvexId.set(instructor.mentorId, instructor.id);
    }
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: { invitationId: string; error: string }[] = [];

  for (const invitation of allInvitations) {
    try {
      const convexInstructorId = instructorMentorIdToConvexId.get(invitation.instructorId);

      if (!convexInstructorId) {
        console.log(`Skipping invitation: ${invitation.id} - missing instructor mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating invitation: ${invitation.id} (${invitation.email}, ${invitation.status})`);
      
      await runConvexMutation("menteeInvitations:migrateInvitation", {
        id: invitation.id,
        email: invitation.email,
        instructorId: convexInstructorId,
        clerkInvitationId: invitation.clerkInvitationId || undefined,
        expiresAt: invitation.expiresAt.getTime(),
        status: invitation.status,
        createdAt: invitation.createdAt.getTime(),
        updatedAt: invitation.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ Invitation migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ invitationId: invitation.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} invitations migrated`);
  console.log(`  - ${skipped} skipped (missing instructor mapping)`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.invitationId}: ${e.error}`);
    }
  }
}

migrateMenteeInvitations()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });