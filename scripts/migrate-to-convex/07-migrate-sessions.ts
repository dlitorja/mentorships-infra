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

import { getDb, sessions, instructors, sessionPacks } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleSession {
  id: string;
  mentorId: string;
  studentId: string;
  sessionPackId: string;
  scheduledAt: Date;
  completedAt: Date | null;
  canceledAt: Date | null;
  status: "scheduled" | "completed" | "canceled" | "no_show";
  recordingConsent: boolean;
  recordingUrl: string | null;
  recordingExpiresAt: Date | null;
  googleCalendarEventId: string | null;
  notes: string | null;
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

async function migrateSessions(): Promise<void> {
  console.log("Starting sessions migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching sessions from Drizzle...");
  const allSessions = await db.select().from(sessions).all();
  console.log(`Found ${allSessions.length} sessions in Drizzle`);

  console.log("Fetching instructors from Drizzle...");
  const allInstructors = await db.select().from(instructors).all();
  console.log(`Found ${allInstructors.length} instructors`);

  console.log("Fetching session packs from Drizzle...");
  const allPacks = await db.select().from(sessionPacks).all();
  console.log(`Found ${allPacks.length} session packs\n`);

  const instructorMentorIdToConvexId = new Map<string, string>();
  for (const instructor of allInstructors) {
    if (instructor.mentorId) {
      instructorMentorIdToConvexId.set(instructor.mentorId, instructor.id);
    }
  }

  const packIdToConvexId = new Map<string, string>();
  for (const pack of allPacks) {
    packIdToConvexId.set(pack.id, pack.id);
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: { sessionId: string; error: string }[] = [];

  for (const session of allSessions) {
    try {
      const convexMentorId = instructorMentorIdToConvexId.get(session.mentorId);
      const convexPackId = packIdToConvexId.get(session.sessionPackId);

      if (!convexMentorId || !convexPackId) {
        console.log(`Skipping session: ${session.id} - missing instructor or pack mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating session: ${session.id} (${session.status})`);
      
      await runConvexMutation("sessions:migrateSession", {
        id: session.id,
        mentorId: convexMentorId,
        studentId: session.studentId,
        sessionPackId: convexPackId,
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