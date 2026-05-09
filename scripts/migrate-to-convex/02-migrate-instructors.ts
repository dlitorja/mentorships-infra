/**
 * Migration Script: 02-migrate-instructors.ts
 * 
 * Migrates instructors and mentors from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/02-migrate-instructors.ts
 * 
 * This script is idempotent - safe to re-run.
 * 
 * Note: This migration combines data from both Drizzle 'instructors' and 'mentors' tables
 * into the Convex 'instructors' table since Convex combines both profile and mentor data.
 */

import { getDb, instructors, mentors, eq } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleInstructor {
  id: string;
  userId: string | null;
  mentorId: string | null;
  email: string | null;
  name: string;
  slug: string;
  tagline: string | null;
  bio: string | null;
  specialties: string[] | null;
  background: string[] | null;
  profileImageUrl: string | null;
  profileImageUploadPath: string | null;
  portfolioImages: string[] | null;
  socials: {
    twitter?: string;
    instagram?: string;
    youtube?: string;
    bluesky?: string;
    website?: string;
    artstation?: string;
  } | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface DrizzleMentor {
  id: string;
  userId: string;
  googleCalendarId: string | null;
  googleRefreshToken: string | null;
  timeZone: string | null;
  workingHours: Record<string, unknown> | null;
  maxActiveStudents: number | null;
  bio: string | null;
  pricing: string | null;
  oneOnOneInventory: number | null;
  groupInventory: number | null;
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

async function migrateInstructors(): Promise<void> {
  console.log("Starting instructor migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching instructors from Drizzle...");
  const allInstructors = await db.select().from(instructors).all();
  console.log(`Found ${allInstructors.length} instructors in Drizzle`);

  console.log("Fetching mentors from Drizzle...");
  const allMentors = await db.select().from(mentors).all();
  console.log(`Found ${allMentors.length} mentors in Drizzle\n`);

  const mentorsById = new Map<string, DrizzleMentor>();
  for (const mentor of allMentors) {
    mentorsById.set(mentor.id, mentor);
  }

  let migrated = 0;
  let errors = 0;
  const errorDetails: { instructorId: string; error: string }[] = [];

  for (const instructor of allInstructors) {
    try {
      console.log(`Migrating instructor: ${instructor.id} (${instructor.name}, slug: ${instructor.slug})`);

      const mentor = instructor.mentorId ? mentorsById.get(instructor.mentorId) : null;

      const args: Record<string, unknown> = {
        userId: instructor.userId || "",
        name: instructor.name,
        slug: instructor.slug,
        email: instructor.email || undefined,
        bio: instructor.bio || undefined,
        tagline: instructor.tagline || undefined,
        background: instructor.background || undefined,
        specialties: instructor.specialties || undefined,
        portfolioImages: instructor.portfolioImages || undefined,
        socials: instructor.socials || undefined,
        isActive: instructor.isActive,
        profileImageUrl: instructor.profileImageUrl || undefined,
        profileImageUploadPath: instructor.profileImageUploadPath || undefined,
        mentorId: instructor.mentorId || undefined,
      };

      if (mentor) {
        args.googleCalendarId = mentor.googleCalendarId || undefined;
        args.googleRefreshToken = mentor.googleRefreshToken || undefined;
        args.timeZone = mentor.timeZone || undefined;
        args.workingHours = mentor.workingHours || undefined;
        args.maxActiveStudents = mentor.maxActiveStudents ?? undefined;
        args.pricing = mentor.pricing || undefined;
        args.oneOnOneInventory = mentor.oneOnOneInventory ?? undefined;
        args.groupInventory = mentor.groupInventory ?? undefined;
      }

      await runConvexMutation("instructors:migrateInstructor", args);

      migrated++;
      console.log(`  ✓ Instructor migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ instructorId: instructor.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} instructors migrated`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails) {
      console.log(`  - ${e.instructorId}: ${e.error}`);
    }
  }
}

migrateInstructors()
  .then(() => {
    console.log("Migration script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });