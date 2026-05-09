/**
 * Migration Script: 06-migrate-session-packs.ts
 * 
 * Migrates session packs from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/06-migrate-session-packs.ts
 * 
 * This script is idempotent - safe to re-run.
 * 
 * Note: SessionPacks have dependencies on orders and instructors.
 * The instructor migration (02) should run first.
 */

import { getDb, sessionPacks, instructors } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleSessionPack {
  id: string;
  userId: string;
  mentorId: string;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: Date;
  expiresAt: Date | null;
  status: "active" | "depleted" | "expired" | "refunded";
  paymentId: string;
  mentorshipType: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface DrizzleInstructor {
  id: string;
  mentorId: string | null;
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

async function migrateSessionPacks(): Promise<void> {
  console.log("Starting session packs migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching session packs from Drizzle...");
  const allPacks = await db.select().from(sessionPacks).all();
  console.log(`Found ${allPacks.length} session packs in Drizzle`);

  console.log("Fetching instructors from Drizzle...");
  const allInstructors = await db.select().from(instructors).all();
  console.log(`Found ${allInstructors.length} instructors in Drizzle\n`);

  const instructorMentorIdToConvexId = new Map<string, string>();
  for (const instructor of allInstructors) {
    if (instructor.mentorId) {
      instructorMentorIdToConvexId.set(instructor.mentorId, instructor.id);
    }
  }

  let migrated = 0;
  let errors = 0;
  const errorDetails: { packId: string; error: string }[] = [];

  for (const pack of allPacks) {
    try {
      console.log(`Migrating session pack: ${pack.id} (${pack.status}, ${pack.mentorType})`);
      
      const convexMentorId = instructorMentorIdToConvexId.get(pack.mentorId);

      await runConvexMutation("sessionPacks:migrateSessionPack", {
        id: pack.id,
        userId: pack.userId,
        mentorId: convexMentorId || pack.mentorId,
        totalSessions: pack.totalSessions,
        remainingSessions: pack.remainingSessions,
        purchasedAt: pack.purchasedAt.getTime(),
        expiresAt: pack.expiresAt?.getTime() || undefined,
        status: pack.status,
        paymentId: pack.paymentId,
        createdAt: pack.createdAt.getTime(),
        updatedAt: pack.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ Session pack migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ packId: pack.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} session packs migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.packId}: ${e.error}`);
    }
  }
}

migrateSessionPacks()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });