/**
 * Migration Script: 13-migrate-discord-action-queue.ts
 * 
 * Migrates Discord action queue from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/13-migrate-discord-action-queue.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, discordActionQueue } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleDiscordAction {
  id: string;
  type: "assign_mentee_role" | "dm_instructor_new_signup";
  status: "pending" | "processing" | "done" | "failed";
  subjectUserId: string;
  mentorId: string | null;
  mentorUserId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  lockedAt: Date | null;
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

async function migrateDiscordActionQueue(): Promise<void> {
  console.log("Starting Discord action queue migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching Discord actions from Drizzle...");
  const allActions = await db.select().from(discordActionQueue).all();
  console.log(`Found ${allActions.length} Discord actions in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { actionId: string; error: string }[] = [];

  for (const action of allActions) {
    try {
      console.log(`Migrating action: ${action.id} (${action.type}, status: ${action.status})`);
      
      await runConvexMutation("discordActionQueue:migrateDiscordAction", {
        type: action.type,
        subjectUserId: action.subjectUserId,
        mentorId: action.mentorId ?? undefined,
        mentorUserId: action.mentorUserId ?? undefined,
        payload: action.payload,
        status: action.status,
        attempts: action.attempts,
        lastError: action.lastError ?? undefined,
        lockedAt: action.lockedAt?.getTime() ?? undefined,
        createdAt: action.createdAt.getTime(),
        updatedAt: action.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ Action migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ actionId: action.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} actions migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails.slice(0, 20)) {
      console.log(`  - ${e.actionId}: ${e.error}`);
    }
    if (errorDetails.length > 20) console.log(`  ... and ${errorDetails.length - 20} more errors`);
  }
}

migrateDiscordActionQueue()
  .then(() => { process.exit(0); })
  .catch((error) => { console.error("Migration script failed:", error); process.exit(1); });