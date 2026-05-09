/**
 * Migration Script: 11-migrate-mentee-session-counts.ts
 * 
 * Migrates mentee session counts from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/11-migrate-mentee-session-counts.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, menteeSessionCounts, instructors } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleMenteeSessionCount {
  id: string;
  userId: string;
  instructorId: string;
  sessionCount: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
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

async function migrateMenteeSessionCounts(): Promise<void> {
  console.log("Starting mentee session counts migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching mentee session counts from Drizzle...");
  const allCounts = await db.select().from(menteeSessionCounts).all();
  console.log(`Found ${allCounts.length} mentee session counts in Drizzle`);

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
  const errorDetails: { countId: string; error: string }[] = [];

  for (const count of allCounts) {
    try {
      const convexInstructorId = instructorMentorIdToConvexId.get(count.instructorId);

      if (!convexInstructorId) {
        console.log(`Skipping session count: ${count.id} - missing instructor mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating session count: ${count.id} (user: ${count.userId}, count: ${count.sessionCount})`);
      
      await runConvexMutation("menteeSessionCounts:migrateSessionCount", {
        id: count.id,
        userId: count.userId,
        instructorId: convexInstructorId,
        sessionCount: count.sessionCount,
        notes: count.notes || undefined,
        createdAt: count.createdAt.getTime(),
        updatedAt: count.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ Session count migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ countId: count.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} session counts migrated`);
  console.log(`  - ${skipped} skipped (missing instructor mapping)`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.countId}: ${e.error}`);
    }
  }
}

migrateMenteeSessionCounts()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });