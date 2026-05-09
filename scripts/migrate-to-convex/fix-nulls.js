/**
 * Fix JSONL files to convert null to undefined (omit field)
 * for Convex import compatibility
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = "./migration-data";

function loadAndFix(filename) {
  const filePath = join(OUTPUT_DIR, filename);
  if (!existsSync(filePath)) {
    console.log(`${filename}: not found, skipping`);
    return;
  }
  
  const content = readFileSync(filePath, "utf-8");
  if (!content.trim()) {
    console.log(`${filename}: empty, skipping`);
    return;
  }
  
  const lines = content.trim().split("\n");
  const fixed = lines.map(line => {
    const obj = JSON.parse(line);
    // Remove null values (Convex expects undefined, which means omit in JSON)
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        cleaned[key] = value;
      }
    }
    return JSON.stringify(cleaned);
  });
  
  writeFileSync(filePath, fixed.join("\n"));
  console.log(`${filename}: fixed ${lines.length} rows`);
}

function main() {
  console.log("\n=== Fixing JSONL files for Convex import ===\n");
  
  // Fix all JSONL files in migration-data
  const files = [
    "users.jsonl",
    "instructors.jsonl",
    "orders.jsonl",
    "payments.jsonl",
    "sessionPacks.jsonl",
    "seatReservations.jsonl",
    "sessions.jsonl",
    "userIdentities.jsonl",
    "discordActionQueue.jsonl",
    "videoEditorAssignments.jsonl",
    "waitlist.jsonl",
    "adminDigestSettings.jsonl",
    "instructorTestimonials.jsonl",
    "menteeResults.jsonl",
    "mentorData.jsonl",
  ];
  
  for (const file of files) {
    loadAndFix(file);
  }
  
  console.log("\n✓ All files fixed!");
}

main();