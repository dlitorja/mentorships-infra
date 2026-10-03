/**
 * Migration Script: 04-migrate-orders.ts
 *
 * Migrates orders from Drizzle (SQL) to Convex.
 *
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/04-migrate-orders.ts
 *
 * Required env vars:
 *   - NEXT_PUBLIC_CONVEX_URL: the Convex deployment URL (e.g.
 *     https://<deployment>.convex.cloud). Must point at the SAME deployment
 *     whose CONVEX_HTTP_KEY is supplied below.
 *   - CONVEX_HTTP_KEY: the deploy key for that deployment. Used both as the
 *     admin auth for the Convex HTTP client AND as the per-mutation
 *     serviceKey arg (which `migrateOrder` checks via assertServiceKey).
 *     Get it from the deployment's "Settings → API Keys" page.
 *
 * This script is idempotent — safe to re-run.
 */

import { getDb, orders } from "../../packages/db/src";
import { ConvexHttpClient } from "convex/browser";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

interface DrizzleOrder {
  id: string;
  userId: string;
  status: "pending" | "paid" | "refunded" | "failed" | "canceled";
  provider: "stripe" | "paypal";
  totalAmount: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function migrateOrders(): Promise<void> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    fail(
      "NEXT_PUBLIC_CONVEX_URL is not set. Point it at the Convex deployment you are migrating TO (e.g. https://<deployment>.convex.cloud).",
    );
  }

  const serviceKey = process.env.CONVEX_HTTP_KEY;
  if (!serviceKey) {
    fail(
      "CONVEX_HTTP_KEY is not set. The migrateOrder mutation is gated by this key as the `serviceKey` arg.\n" +
        "Get the deploy key from the Convex deployment's \"Settings → API Keys\" page (NOT a different deployment's key),\n" +
        "then re-run with:\n" +
        "  export CONVEX_HTTP_KEY=<deploy key for the deployment in NEXT_PUBLIC_CONVEX_URL>",
    );
  }

  const convex = new ConvexHttpClient(convexUrl);
  convex.setAdminAuth(serviceKey);

  console.log("Starting orders migration to Convex...\n");
  console.log(`  deployment: ${convexUrl}\n`);

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching orders from Drizzle...");
  const allOrders = await db.select().from(orders).all();

  console.log(`Found ${allOrders.length} orders in Drizzle\n`);

  let migrated = 0;
  const errorDetails: { orderId: string; error: string }[] = [];

  // Fail the run on any per-row error. Without this, a misconfigured key
  // (or a bad row) would be silently skipped and the script would exit 0.
  for (const order of allOrders) {
    console.log(`Migrating order: ${order.id} (${order.status}, ${order.provider})`);
    try {
      await convex.mutation("orders:migrateOrder", {
        id: order.id,
        userId: order.userId,
        status: order.status,
        provider: order.provider,
        totalAmount: order.totalAmount,
        currency: order.currency,
        createdAt: order.createdAt.getTime(),
        updatedAt: order.updatedAt.getTime(),
        serviceKey,
      });
      migrated++;
      console.log(`  ✓ Order migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errorDetails.push({ orderId: order.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} orders migrated`);
  console.log(`  - ${errorDetails.length} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.orderId}: ${e.error}`);
    }
    fail(
      `Migration completed with ${errorDetails.length} error(s). The script exits non-zero so the failure is visible to whatever ran it.`,
    );
  }
}

migrateOrders()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
