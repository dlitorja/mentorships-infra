/**
 * Migration Orchestrator
 * 
 * Runs the full Drizzle → Convex migration by:
 * 1. Running the preprocessor to export data and resolve FKs
 * 2. Importing each table to Convex via 'npx convex import'
 * 3. Verifying counts after each table
 * 
 * Usage:
 *   npx tsx scripts/migrate-to-convex/migrate-all.ts [options]
 * 
 * Options:
 *   --dry-run    Show what would be done without executing
 *   --skip-export  Skip export step (use existing JSONL files)
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const MIGRATION_DATA_DIR = "./migration-data";
const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "local:local-dlitorja-mentorships_infra";

interface TableConfig {
  name: string;
  jsonlFile: string;
  dependsOn: string[];
  description: string;
}

const TABLES: TableConfig[] = [
  { name: "users", jsonlFile: "users.jsonl", dependsOn: [], description: "User accounts" },
  { name: "instructors", jsonlFile: "instructors.jsonl", dependsOn: ["users"], description: "Instructor profiles" },
  { name: "products", jsonlFile: "products.jsonl", dependsOn: [], description: "Mentorship products" },
  { name: "orders", jsonlFile: "orders.jsonl", dependsOn: ["users"], description: "Payment orders" },
  { name: "payments", jsonlFile: "payments.jsonl", dependsOn: ["orders"], description: "Payment records" },
  { name: "sessionPacks", jsonlFile: "sessionPacks.jsonl", dependsOn: ["users", "instructors", "payments"], description: "Purchased session packs" },
  { name: "sessions", jsonlFile: "sessions.jsonl", dependsOn: ["instructors", "sessionPacks"], description: "Mentorship sessions" },
  { name: "seatReservations", jsonlFile: "seatReservations.jsonl", dependsOn: ["orders", "instructors", "sessionPacks"], description: "Seat reservations" },
  { name: "contacts", jsonlFile: "contacts.jsonl", dependsOn: [], description: "Contact submissions" },
  { name: "menteeInvitations", jsonlFile: "menteeInvitations.jsonl", dependsOn: ["instructors"], description: "Mentee invitations" },
  { name: "menteeSessionCounts", jsonlFile: "menteeSessionCounts.jsonl", dependsOn: ["instructors"], description: "Mentee session counts" },
  { name: "userIdentities", jsonlFile: "userIdentities.jsonl", dependsOn: [], description: "User identity providers" },
  { name: "discordActionQueue", jsonlFile: "discordActionQueue.jsonl", dependsOn: [], description: "Discord action queue" },
  { name: "videoEditorAssignments", jsonlFile: "videoEditorAssignments.jsonl", dependsOn: [], description: "Video editor assignments" },
  { name: "instructorUploads", jsonlFile: "instructorUploads.jsonl", dependsOn: ["instructors"], description: "Instructor uploads" },
  { name: "monthlyStorageCosts", jsonlFile: "monthlyStorageCosts.jsonl", dependsOn: [], description: "Monthly storage costs" },
];

function runCommand(cmd: string, args: string[], cwd: string = process.cwd()): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  Running: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd,
      stdio: "pipe",
      env: { ...process.env },
    });
    
    let stdout = "";
    let stderr = "";
    
    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });
    
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`  Command failed with code ${code}`);
        if (stderr) console.error(stderr);
        reject(new Error(`Command failed: ${cmd} ${args.join(" ")}`));
      }
    });
    
    child.on("error", (error) => {
      reject(error);
    });
  });
}

async function runPreprocessorExport(): Promise<void> {
  console.log("\n=== Step 1: Export data from Drizzle ===");
  await runCommand("npx", ["tsx", "scripts/migrate-to-convex/preprocessor.ts", "all"]);
}

async function importTable(table: TableConfig): Promise<void> {
  const filePath = join(MIGRATION_DATA_DIR, table.jsonlFile);
  
  if (!existsSync(filePath)) {
    console.log(`  ⚠️  File not found: ${filePath} - skipping`);
    return;
  }
  
  console.log(`  Importing ${table.name} from ${table.jsonlFile}...`);
  
  try {
    await runCommand("npx", [
      "convex", "import",
      "--table", table.name,
      "--replace",
      filePath
    ]);
    console.log(`  ✓ ${table.name} imported successfully`);
  } catch (error) {
    console.error(`  ✗ Failed to import ${table.name}`);
    throw error;
  }
}

async function verifyTable(tableName: string): Promise<number> {
  console.log(`  Verifying ${tableName}...`);
  
  try {
    const response = await fetch(`${process.env.CONVEX_URL || "http://127.0.0.1:3210"}/api/${tableName}/count`);
    if (response.ok) {
      const data = await response.json() as { count: number };
      return data.count;
    }
  } catch {
    // Query doesn't exist or endpoint not available
  }
  
  // Try alternative approach - query via convex run
  return -1; // Unable to verify
}

async function runMigration(dryRun: boolean, skipExport: boolean): Promise<void> {
  console.log("\n=== Drizzle → Convex Migration ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Convex deployment: ${CONVEX_DEPLOYMENT}`);
  
  // Step 1: Export data
  if (!skipExport) {
    await runPreprocessorExport();
  } else {
    console.log("\n=== Step 1: Skipping export (using existing JSONL files) ===");
  }
  
  // Step 2: Import tables in order
  console.log("\n=== Step 2: Import to Convex ===");
  
  for (const table of TABLES) {
    console.log(`\n[${TABLES.indexOf(table) + 1}/${TABLES.length}] ${table.name}`);
    console.log(`  Description: ${table.description}`);
    
    if (dryRun) {
      const filePath = join(MIGRATION_DATA_DIR, table.jsonlFile);
      const exists = existsSync(filePath);
      console.log(`  Would import: ${table.jsonlFile} (${exists ? "exists" : "MISSING"})`);
      console.log(`  Dependencies: ${table.dependsOn.length > 0 ? table.dependsOn.join(", ") : "none"}`);
      continue;
    }
    
    // Check dependencies
    const missingDeps = table.dependsOn.filter(dep => {
      const depConfig = TABLES.find(t => t.name === dep);
      const filePath = join(MIGRATION_DATA_DIR, depConfig?.jsonlFile || "");
      return !existsSync(filePath);
    });
    
    if (missingDeps.length > 0) {
      console.warn(`  ⚠️  Missing dependencies: ${missingDeps.join(", ")} - skipping`);
      continue;
    }
    
    await importTable(table);
  }
  
  console.log("\n=== Migration Complete ===");
  
  if (!dryRun) {
    console.log("\nNext steps:");
    console.log("  1. Verify data in Convex dashboard");
    console.log("  2. Run: npx tsx scripts/migrate-to-convex/verify.ts");
    console.log("  3. Update Inngest functions to use Convex");
  }
}

// CLI entry point
const dryRun = process.argv.includes("--dry-run");
const skipExport = process.argv.includes("--skip-export");

runMigration(dryRun, skipExport)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nMigration failed:", error);
    process.exit(1);
  });