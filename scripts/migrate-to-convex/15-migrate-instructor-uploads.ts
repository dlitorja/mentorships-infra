/**
 * Migration Script: 15-migrate-instructor-uploads.ts
 * 
 * Migrates instructor uploads from Drizzle (SQL) to Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/migrate-to-convex/15-migrate-instructor-uploads.ts
 * 
 * This script is idempotent - safe to re-run.
 */

import { getDb, instructorUploads, instructors } from "../../packages/db/src";
import { spawn } from "child_process";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../packages/db/src/schema";

const CONVEX_DEPLOYMENT = process.env.CONVEX_DEPLOYMENT || "dev";

interface DrizzleInstructorUpload {
  id: string;
  instructorId: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  b2FileId: string | null;
  b2UploadId: string | null;
  b2PartEtags: string | null;
  status: "pending" | "uploading" | "completed" | "archived" | "failed" | "deleted";
  errorMessage: string | null;
  archivedAt: Date | null;
  s3Key: string | null;
  s3Url: string | null;
  transferStatus: "pending" | "transferring" | "completed" | "failed" | null;
  transferRetryCount: number | null;
  notifiedAt: Date | null;
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

async function migrateInstructorUploads(): Promise<void> {
  console.log("Starting instructor uploads migration to Convex...\n");

  const db = getDb() as PostgresJsDatabase<typeof schema>;

  console.log("Fetching instructor uploads from Drizzle...");
  const allUploads = await db.select().from(instructorUploads).all();
  console.log(`Found ${allUploads.length} instructor uploads in Drizzle`);

  console.log("Fetching instructors from Drizzle...");
  const allInstructors = await db.select().from(instructors).all();
  console.log(`Found ${allInstructors.length} instructors\n`);

  const instructorMentorIdToConvexId = new Map<string, string>();
  for (const instructor of allInstructors) {
    if (instructor.mentorId) {
      instructorMentorIdToConvexId.set(instructor.mentorId, instructor.id);
    }
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: { uploadId: string; error: string }[] = [];

  for (const upload of allUploads) {
    try {
      const instructorConvexId = instructorMentorIdToConvexId.get(upload.instructorId);

      if (!instructorConvexId) {
        console.log(`Skipping upload: ${upload.id} - missing instructor mapping`);
        skipped++;
        continue;
      }

      console.log(`Migrating upload: ${upload.id} (${upload.filename}, ${upload.status})`);
      
      await runConvexMutation("instructorUploads:migrateInstructorUpload", {
        id: upload.id,
        instructorId: instructorConvexId,
        filename: upload.filename,
        originalName: upload.originalName,
        contentType: upload.contentType,
        size: upload.size,
        b2FileId: upload.b2FileId ?? undefined,
        b2UploadId: upload.b2UploadId ?? undefined,
        b2PartEtags: upload.b2PartEtags ?? undefined,
        status: upload.status,
        errorMessage: upload.errorMessage ?? undefined,
        archivedAt: upload.archivedAt?.getTime() ?? undefined,
        s3Key: upload.s3Key ?? undefined,
        s3Url: upload.s3Url ?? undefined,
        transferStatus: upload.transferStatus ?? undefined,
        transferRetryCount: upload.transferRetryCount ?? undefined,
        notifiedAt: upload.notifiedAt?.getTime() ?? undefined,
        createdAt: upload.createdAt.getTime(),
        updatedAt: upload.updatedAt.getTime(),
        deletedAt: upload.deletedAt?.getTime() ?? undefined,
      });

      migrated++;
      console.log(`  ✓ Upload migrated successfully`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${errorMessage}`);
      errors++;
      errorDetails.push({ uploadId: upload.id, error: errorMessage });
    }
  }

  console.log("\n========================================");
  console.log("Migration complete:");
  console.log(`  - ${migrated} uploads migrated`);
  console.log(`  - ${skipped} skipped (missing instructor mapping)`);
  console.log(`  - ${errors} errors`);
  console.log("========================================\n");

  if (errorDetails.length > 0) {
    console.log("Errors:");
    for (const e of errorDetails.slice(0, 20)) {
      console.log(`  - ${e.uploadId}: ${e.error}`);
    }
    if (errorDetails.length > 20) console.log(`  ... and ${errorDetails.length - 20} more errors`);
  }
}

migrateInstructorUploads()
  .then(() => { process.exit(0); })
  .catch((error) => { console.error("Migration script failed:", error); process.exit(1); });