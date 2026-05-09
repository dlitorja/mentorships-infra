/**
 * Migration Script: 01-migrate-users.ts
 * 
 * Migrates users from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/01-migrate-users.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, users, eq } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "local:local-dlitorja-mentorships_infra";

interface UserRecord {
  id: string;
  email: string;
  role: "student" | "mentor" | "admin" | "video_editor";
  timeZone: string | null;
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
      "--typecheck", "disable"
    ], {
      cwd: process.cwd(),
      shell: false,
      env: { ...process.env },
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

async function migrateUsers(): Promise<void> {
  console.log("Starting user migration to Convex...\n");

  if (!CONVEX_URL) {
    console.error("ERROR: NEXT_PUBLIC_CONVEX_URL environment variable is required");
    process.exit(1);
  }

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching users from Drizzle...");
  const allUsers = await db.select().from(users);
  
  console.log(`Found ${allUsers.length} users in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { userId: string; error: string }[] = [];

  for (const user of allUsers) {
    try {
      console.log(`Migrating user: ${user.id} (${user.email})`);
      
      await runConvexMutation("users:migrateUser", {
        userId: user.id,
        email: user.email,
        role: user.role,
        timeZone: user.timeZone || undefined,
        createdAt: user.createdAt.getTime(),
        updatedAt: user.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ User migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ userId: user.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} users migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.userId}: ${e.error}`);
    }
  }
}

migrateUsers()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });