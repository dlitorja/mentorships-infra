/**
 * Migration Script: 12-migrate-user-identities.ts
 * 
 * Migrates user identities from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/12-migrate-user-identities.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, userIdentities } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleUserIdentity {
  id: string;
  userId: string;
  provider: "discord";
  providerUserId: string;
  connectedAt: Date;
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

async function migrateUserIdentities(): Promise<void> {
  console.log("Starting user identities migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching user identities from Drizzle...");
  const allIdentities = await db.select().from(userIdentities).all();
  
  console.log(`Found ${allIdentities.length} user identities in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { identityId: string; error: string }[] = [];

  for (const identity of allIdentities) {
    try {
      console.log(`Migrating user identity: ${identity.id} (${identity.provider}:${identity.providerUserId})`);
      
      await runConvexMutation("userIdentities:migrateUserIdentity", {
        userId: identity.userId,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        connectedAt: identity.connectedAt.getTime(),
        createdAt: identity.createdAt.getTime(),
        updatedAt: identity.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ User identity migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ identityId: identity.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} user identities migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.identityId}: ${e.error}`);
    }
  }
}

migrateUserIdentities()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });