/**
 * Migration Script: 07-migrate-sessions.ts
 * 
 * Migrates sessions from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/07-migrate-sessions.ts
 * 
 * This script is idempotent - safe to re-run.
 * 
 * Note: Sessions have dependencies on instructors and sessionPacks.
 * Those migrations should run first.
 */

import { getDb, instructors, sessions } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

async function runConvexFunction(functionName: string, args: Record<string, unknown>): Promise<unknown> {
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

async function migrateSessions(): Promise<void> {
  console.log("Starting sessions migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching sessions from Drizzle...");
  const allSessions = await db.select().from(sessions).all();
  console.log(`Found ${allSessions.length} sessions in Drizzle`);

  const allInstructors = await db.select().from(instructors).all();
  const instructorUserIdById = new Map(
    allInstructors.map((instructor) => [instructor.id, instructor.userId])
  );

  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: { sessionId: string; error: string }[] = [];

  for (const session of allSessions) {
    try {
      if (!session.instructorId) {
        console.log(`Skipping session: ${session.id} - missing instructor`);
        skipped++;
        continue;
      }
      const instructorUserId = instructorUserIdById.get(session.instructorId);
      if (!instructorUserId) {
        console.log(`Skipping session: ${session.id} - instructor has no user mapping`);
        skipped++;
        continue;
      }
      const dependencies = (await runConvexFunction(
        "sessions:resolveLegacySessionDependencies",
        {
          instructorUserId,
          sessionPackLegacyId: session.sessionPackId,
        }
      )) as { instructorId: string | null; sessionPackId: string | null };

      if (!dependencies.instructorId || !dependencies.sessionPackId) {
        console.log(`Skipping session: ${session.id} - missing instructor or pack mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating session: ${session.id} (${session.status})`);
      
      await runConvexFunction("sessions:migrateSession", {
        id: session.id,
        instructorId: dependencies.instructorId,
        studentId: session.studentId,
        sessionPackId: dependencies.sessionPackId,
        scheduledAt: session.scheduledAt.getTime(),
        completedAt: session.completedAt?.getTime() || undefined,
        canceledAt: session.canceledAt?.getTime() || undefined,
        status: session.status,
        recordingConsent: session.recordingConsent,
        recordingUrl: session.recordingUrl || undefined,
        recordingExpiresAt: session.recordingExpiresAt?.getTime() || undefined,
        googleCalendarEventId: session.googleCalendarEventId || undefined,
        notes: session.notes || undefined,
      });

      migrated++;
      console.log(`  ✓ Session migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ sessionId: session.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} sessions migrated`);
  console.log(`  - ${skipped} sessions skipped (missing mappings)`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.sessionId}: ${e.error}`);
    }
  }
  if (skipped > 0 || errors > 0) {
    throw new Error(
      `Session migration incomplete: ${skipped} skipped, ${errors} failed`
    );
  }
}

migrateSessions()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
