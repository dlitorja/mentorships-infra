/**
 * Migration Script: 08-migrate-seat-reservations.ts
 * 
 * Migrates seat reservations from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/08-migrate-seat-reservations.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, seatReservations, instructors, sessionPacks } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleSeatReservation {
  id: string;
  mentorId: string;
  userId: string;
  sessionPackId: string;
  seatExpiresAt: Date;
  gracePeriodEndsAt: Date | null;
  finalWarningNotificationSentAt: Date | null;
  status: "active" | "grace" | "released";
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

async function migrateSeatReservations(): Promise<void> {
  console.log("Starting seat reservations migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching seat reservations from Drizzle...");
  const allSeats = await db.select().from(seatReservations).all();
  console.log(`Found ${allSeats.length} seat reservations in Drizzle`);

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
  const errorDetails: { seatId: string; error: string }[] = [];

  for (const seat of allSeats) {
    try {
      const convexMentorId = instructorMentorIdToConvexId.get(seat.mentorId);
      const convexPackId = packIdToConvexId.get(seat.sessionPackId);

      if (!convexMentorId || !convexPackId) {
        console.log(`Skipping seat reservation: ${seat.id} - missing instructor or pack mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating seat reservation: ${seat.id} (${seat.status})`);
      
      await runConvexMutation("seatReservations:migrateSeatReservation", {
        id: seat.id,
        mentorId: convexMentorId,
        userId: seat.userId,
        sessionPackId: convexPackId,
        seatExpiresAt: seat.seatExpiresAt.getTime(),
        gracePeriodEndsAt: seat.gracePeriodEndsAt?.getTime() || undefined,
        finalWarningNotificationSentAt: seat.finalWarningNotificationSentAt?.getTime() || undefined,
        status: seat.status,
      });

      migrated++;
      console.log(`  ✓ Seat reservation migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ seatId: seat.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} seat reservations migrated`);
  console.log(`  - ${skipped} skipped (missing mappings)`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.seatId}: ${e.error}`);
    }
  }
}

migrateSeatReservations()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });