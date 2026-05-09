/**
 * Migration Script: 05-migrate-payments.ts
 * 
 * Migrates payments from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/05-migrate-payments.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, payments } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzlePayment {
  id: string;
  orderId: string;
  provider: "stripe" | "paypal";
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: "pending" | "completed" | "refunded" | "failed";
  refundedAmount: string | null;
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

async function migratePayments(): Promise<void> {
  console.log("Starting payments migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching payments from Drizzle...");
  const allPayments = await db.select().from(payments).all();
  
  console.log(`Found ${allPayments.length} payments in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { paymentId: string; error: string }[] = [];

  for (const payment of allPayments) {
    try {
      console.log(`Migrating payment: ${payment.id} (${payment.status}, ${payment.provider})`);
      
      await runConvexMutation("payments:migratePayment", {
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        refundedAmount: payment.refundedAmount || undefined,
        createdAt: payment.createdAt.getTime(),
        updatedAt: payment.updatedAt.getTime(),
      });

      migrated++;
      console.log(`  ✓ Payment migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ paymentId: payment.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} payments migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.paymentId}: ${e.error}`);
    }
  }
}

migratePayments()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });