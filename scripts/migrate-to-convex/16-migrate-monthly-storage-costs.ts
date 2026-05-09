/**
 * Migration Script: 16-migrate-monthly-storage-costs.ts
 * 
 * Migrates monthly storage costs from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/16-migrate-monthly-storage-costs.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, monthlyStorageCosts } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleMonthlyStorageCost {
  id: string;
  month: string;
  b2StorageCost: number;
  b2DownloadCost: number;
  b2ApiCost: number;
  s3StorageCost: number;
  s3RetrievalCost: number;
  totalCost: number;
  alertSent: boolean;
  alertThreshold: number;
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

async function migrateMonthlyStorageCosts(): Promise<void> {
  console.log("Starting monthly storage costs migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching monthly storage costs from Drizzle...");
  const allCosts = await db.select().from(monthlyStorageCosts).all();
  console.log(`Found ${allCosts.length} monthly storage costs in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { costId: string; error: string }[] = [];

  for (const cost of allCosts) {
    try {
      console.log(`Migrating storage cost: ${cost.id} (${cost.month})`);
      
      await runConvexMutation("monthlyStorageCosts:migrateMonthlyStorageCost", {
        id: cost.id,
        month: cost.month,
        b2StorageCost: cost.b2StorageCost,
        b2DownloadCost: cost.b2DownloadCost,
        b2ApiCost: cost.b2ApiCost,
        s3StorageCost: cost.s3StorageCost,
        s3RetrievalCost: cost.s3RetrievalCost,
        totalCost: cost.totalCost,
        alertSent: cost.alertSent,
        alertThreshold: cost.alertThreshold,
        createdAt: cost.createdAt.getTime(),
        updatedAt: cost.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ Storage cost migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ costId: cost.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} storage costs migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.costId}: ${e.error}`);
    }
  }
}

migrateMonthlyStorageCosts()
  .then(() => { process.exit(0); })
  .catch((error) => { console.error("Migration script failed:", error); process.exit(1); });