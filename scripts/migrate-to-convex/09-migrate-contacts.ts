/**
 * Migration Script: 09-migrate-contacts.ts
 * 
 * Migrates contacts from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/09-migrate-contacts.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, contacts } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleContact {
  id: string;
  email: string;
  artGoals: string | null;
  source: string | null;
  optedIn: boolean | null;
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

async function migrateContacts(): Promise<void> {
  console.log("Starting contacts migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching contacts from Drizzle...");
  const allContacts = await db.select().from(contacts).all();
  
  console.log(`Found ${allContacts.length} contacts in Drizzle\n`);

  let migrated = 0;
  let errors = 0;
  const errorDetails: { contactId: string; error: string }[] = [];

  for (const contact of allContacts) {
    try {
      console.log(`Migrating contact: ${contact.id} (${contact.email})`);
      
      await runConvexMutation("contacts:migrateContact", {
        email: contact.email,
        artGoals: contact.artGoals || undefined,
        source: contact.source || undefined,
        optedIn: contact.optedIn ?? undefined,
      });

      migrated++;
      console.log(`  ✓ Contact migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ contactId: contact.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} contacts migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.contactId}: ${e.error}`);
    }
  }
}

migrateContacts()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });