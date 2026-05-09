/**
 * Migration Script: 03-migrate-products.ts
 * 
 * Migrates products from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/03-migrate-products.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, products } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleProduct {
  id: string;
  mentorId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  currency: string;
  sessionsPerPack: number;
  validityDays: number;
  stripePriceId: string | null;
  stripeProductId: string | null;
  paypalProductId: string | null;
  mentorshipType: string;
  active: boolean;
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

async function migrateProducts(): Promise<void> {
  console.log("Starting products migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching products from Drizzle...");
  const allProducts = await db.select().from(products).all();
  
  console.log(`Found ${allProducts.length} products in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { productId: string; error: string }[] = [];

  for (const product of allProducts) {
    try {
      console.log(`Migrating product: ${product.id} (${product.title})`);
      
      await runConvexMutation("products:migrateProduct", {
        id: product.id,
        mentorId: product.mentorId,
        title: product.title,
        description: product.description || undefined,
        imageUrl: product.imageUrl || undefined,
        price: product.price,
        currency: product.currency,
        sessionsPerPack: product.sessionsPerPack,
        validityDays: product.validityDays,
        stripePriceId: product.stripePriceId || undefined,
        stripeProductId: product.stripeProductId || undefined,
        paypalProductId: product.paypalProductId || undefined,
        mentorshipType: product.mentorshipType,
        active: product.active,
      });

      migrated++;
      console.log(`  ✓ Product migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ productId: product.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} products migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.productId}: ${e.error}`);
    }
  }
}

migrateProducts()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });