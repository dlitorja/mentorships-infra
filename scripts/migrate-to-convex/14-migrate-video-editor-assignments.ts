/**
 * Migration Script: 14-migrate-video-editor-assignments.ts
 * 
 * Migrates video editor assignments from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/14-migrate-video-editor-assignments.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, videoEditorAssignments, users, instructors } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleVideoEditorAssignment {
  id: string;
  videoEditorId: string;
  instructorId: string;
  assignedAt: Date;
  assignedBy: string;
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

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${functionName} failed (code ${code}): ${stderr || stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      try {
        resolve(trimmed.startsWith("{") || trimmed.startsWith("[") ? JSON.parse(trimmed) : { success: true, raw: trimmed });
      } catch {
        resolve({ success: true, raw: stdout });
      }
    });
  });
}

async function migrateVideoEditorAssignments(): Promise<void> {
  console.log("Starting video editor assignments migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching video editor assignments from Drizzle...");
  const allAssignments = await db.select().from(videoEditorAssignments).all();
  console.log(`Found ${allAssignments.length} video editor assignments in Drizzle`);

  console.log("Fetching users from Drizzle...");
  const allUsers = await db.select().from(users).all();
  console.log(`Found ${allUsers.length} users`);

  console.log("Fetching instructors from Drizzle...");
  const allInstructors = await db.select().from(instructors).all();
  console.log(`Found ${allInstructors.length} instructors\n`);

  const userClerkIdToConvexId = new Map<string, string>();
  for (const user of allUsers) {
    if (user.clerkId) {
      userClerkIdToConvexId.set(user.clerkId, user.id);
    }
  }

  const instructorMentorIdToConvexId = new Map<string, string>();
  for (const instructor of allInstructors) {
    if (instructor.mentorId) {
      instructorMentorIdToConvexId.set(instructor.mentorId, instructor.id);
    }
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: { assignmentId: string; error: string }[] = [];

  for (const assignment of allAssignments) {
    try {
      const videoEditorConvexId = userClerkIdToConvexId.get(assignment.videoEditorId);
      const instructorConvexId = instructorMentorIdToConvexId.get(assignment.instructorId);
      const assignedByConvexId = userClerkIdToConvexId.get(assignment.assignedBy);

      if (!videoEditorConvexId || !instructorConvexId || !assignedByConvexId) {
        console.log(`Skipping assignment: ${assignment.id} - missing mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating assignment: ${assignment.id} (videoEditor: ${assignment.videoEditorId} → ${videoEditorConvexId})`);
      
      await runConvexMutation("videoEditorAssignments:migrateVideoEditorAssignment", {
        videoEditorId: videoEditorConvexId,
        instructorId: instructorConvexId,
        assignedAt: assignment.assignedAt.getTime(),
        assignedBy: assignedByConvexId,
      });

      migrated++;
      console.log(`  ✓ Assignment migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ assignmentId: assignment.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} assignments migrated`);
  console.log(`  - ${skipped} skipped (missing mapping)`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails.slice(0, 20)) {
      console.log(`  - ${e.assignmentId}: ${e.error}`);
    }
    if (errorDetails.length > 20) console.log(`  ... and ${errorDetails.length - 20} more errors`);
  }
}

migrateVideoEditorAssignments()
  .then(() => { process.exit(0); })
  .catch((error) => { console.error("Migration script failed:", error); process.exit(1); });