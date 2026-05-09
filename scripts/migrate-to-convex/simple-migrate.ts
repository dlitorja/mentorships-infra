/**
 * Simple Drizzle to Convex Migration Script
 * 
 * Single script that:
 * 1. Connects directly to Drizzle (no subprocess for DB access)
 * 2. Exports tables to JSONL files
 * 3. Imports to Convex via npx convex import
 * 
 * Usage:
 *   set -a && source .env.local && set +a && npx tsx scripts/migrate-to-convex/simple-migrate.ts
 * 
 * Options:
 *   --export-only   Just export to JSONL, don't import
 *   --import-only   Just import from JSONL, don't export
 *   --dry-run       Show what would happen without running
 */

import { getDb } from "../../packages/db/src";
import { sql } from "drizzle-orm";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

const OUTPUT_DIR = "./migration-data";

// Ensure output directory exists
function ensureOutputDir(): void {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

// Export a table to JSONL
async function exportTable(tableName: string, query: string, transform: (row: Record<string, unknown>) => Record<string, unknown>): Promise<number> {
  console.log(`  Exporting ${tableName}...`);
  
  const db = getDb();
  const result = await db.execute(sql.raw(query));
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map(transform);
  const filePath = join(OUTPUT_DIR, `${tableName}.jsonl`);
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  
  console.log(`    ✓ ${records.length} rows`);
  return records.length;
}

// Import JSONL to Convex
async function importTable(tableName: string): Promise<void> {
  const filePath = join(OUTPUT_DIR, `${tableName}.jsonl`);
  if (!existsSync(filePath)) {
    console.log(`    ⚠ File not found: ${filePath} - skipping`);
    return;
  }
  
  console.log(`  Importing ${tableName}...`);
  
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["convex", "import", "--table", tableName, "--replace", filePath], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env },
    });
    
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`    ✓ ${tableName} imported`);
        resolve();
      } else {
        reject(new Error(`Import failed with code ${code}`));
      }
    });
    
    child.on("error", reject);
  });
}

// Table export definitions - tables without complex FK dependencies
const simpleTables = [
  {
    name: "users",
    query: `SELECT id, email, role, time_zone, created_at, updated_at, deleted_at FROM users ORDER BY created_at`,
    transform: (row) => ({
      userId: row.id,
      email: row.email,
      clerkId: row.id,
      role: row.role || "student",
      timeZone: row.time_zone,
      legacyId: row.id,
    }),
  },
  {
    name: "products",
    query: `SELECT id, mentor_id, title, description, image_url, price, currency, sessions_per_pack, validity_days, stripe_price_id, stripe_product_id, paypal_product_id, mentorship_type, active, deleted_at, created_at, updated_at FROM mentorship_products ORDER BY created_at`,
    transform: (row) => ({
      mentorId: row.mentor_id,
      title: row.title,
      description: row.description,
      imageUrl: row.image_url,
      price: row.price,
      currency: row.currency,
      sessionsPerPack: row.sessions_per_pack,
      validityDays: row.validity_days,
      stripePriceId: row.stripe_price_id,
      stripeProductId: row.stripe_product_id,
      paypalProductId: row.paypal_product_id,
      mentorshipType: row.mentorship_type,
      active: row.active,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "orders",
    query: `SELECT id, user_id, status, provider, total_amount, currency, deleted_at, created_at, updated_at FROM orders ORDER BY created_at`,
    transform: (row) => ({
      userId: row.user_id,
      status: row.status,
      provider: row.provider,
      totalAmount: row.total_amount,
      currency: row.currency,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "payments",
    query: `SELECT id, order_id, provider, provider_payment_id, amount, currency, status, refunded_amount, deleted_at, created_at, updated_at FROM payments ORDER BY created_at`,
    transform: (row) => ({
      orderId: row.order_id,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      refundedAmount: row.refunded_amount,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "contacts",
    query: `SELECT id, email, art_goals, source, opted_in, created_at, updated_at FROM contacts ORDER BY created_at`,
    transform: (row) => ({
      email: row.email,
      artGoals: row.art_goals,
      source: row.source,
      optedIn: row.opted_in,
      legacyId: row.id,
    }),
  },
  {
    name: "userIdentities",
    query: `SELECT id, user_id, provider, provider_user_id, connected_at, created_at, updated_at FROM user_identities ORDER BY created_at`,
    transform: (row) => ({
      userId: row.user_id,
      provider: row.provider,
      providerUserId: row.provider_user_id,
      connectedAt: row.connected_at ? new Date(row.connected_at as string).getTime() : null,
      createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
      legacyId: row.id,
    }),
  },
  {
    name: "discordActionQueue",
    query: `SELECT id, type, status, subject_user_id, mentor_id, mentor_user_id, payload, attempts, last_error, locked_at, created_at, updated_at FROM discord_action_queue ORDER BY created_at`,
    transform: (row) => ({
      type: row.type,
      status: row.status,
      subjectUserId: row.subject_user_id,
      mentorId: row.mentor_id,
      mentorUserId: row.mentor_user_id,
      payload: row.payload,
      attempts: row.attempts,
      lastError: row.last_error,
      lockedAt: row.locked_at ? new Date(row.locked_at as string).getTime() : null,
      createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
      legacyId: row.id,
    }),
  },
  {
    name: "monthlyStorageCosts",
    query: `SELECT id, month, b2_storage_cost, b2_download_cost, b2_api_cost, s3_storage_cost, s3_retrieval_cost, total_cost, alert_sent, alert_threshold, created_at, updated_at FROM monthly_storage_costs ORDER BY month`,
    transform: (row) => ({
      month: row.month,
      b2StorageCost: row.b2_storage_cost,
      b2DownloadCost: row.b2_download_cost,
      b2ApiCost: row.b2_api_cost,
      s3StorageCost: row.s3_storage_cost,
      s3RetrievalCost: row.s3_retrieval_cost,
      totalCost: row.total_cost,
      alertSent: row.alert_sent,
      alertThreshold: row.alert_threshold,
      createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
      legacyId: row.id,
    }),
  },
];

// Tables with FK dependencies - will export but FK resolution would need mapping
const dependentTables = [
  {
    name: "instructors",
    query: `SELECT m.id, m.user_id, m.google_calendar_id, m.google_refresh_token, m.time_zone, m.working_hours, m.max_active_students, m.bio, m.pricing, m.one_on_one_inventory, m.group_inventory, m.created_at, m.updated_at, m.deleted_at, u.email, u.time_zone as user_time_zone FROM mentors m LEFT JOIN users u ON m.user_id = u.id ORDER BY m.created_at`,
    transform: (row) => ({
      userId: row.user_id,
      name: null,
      email: row.email,
      googleCalendarId: row.google_calendar_id,
      googleRefreshToken: row.google_refresh_token,
      timeZone: row.time_zone || row.user_time_zone,
      workingHours: row.working_hours,
      maxActiveStudents: row.max_active_students,
      bio: row.bio,
      pricing: row.pricing,
      oneOnOneInventory: row.one_on_one_inventory,
      groupInventory: row.group_inventory,
      mentorId: row.id,
      legacyId: row.id,
      createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "sessionPacks",
    query: `SELECT id, user_id, mentor_id, total_sessions, remaining_sessions, purchased_at, expires_at, status, payment_id, deleted_at, created_at, updated_at FROM session_packs ORDER BY created_at`,
    transform: (row) => ({
      userId: row.user_id,
      mentorId: row.mentor_id,
      totalSessions: row.total_sessions,
      remainingSessions: row.remaining_sessions,
      purchasedAt: row.purchased_at ? new Date(row.purchased_at as string).getTime() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at as string).getTime() : null,
      status: row.status,
      paymentId: row.payment_id,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "sessions",
    query: `SELECT id, mentor_id, student_id, session_pack_id, scheduled_at, completed_at, canceled_at, status, recording_consent, recording_url, recording_expires_at, google_calendar_event_id, notes, deleted_at, created_at, updated_at FROM sessions ORDER BY scheduled_at`,
    transform: (row) => ({
      mentorId: row.mentor_id,
      studentId: row.student_id,
      sessionPackId: row.session_pack_id,
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string).getTime() : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string).getTime() : null,
      canceledAt: row.canceled_at ? new Date(row.canceled_at as string).getTime() : null,
      status: row.status,
      recordingConsent: row.recording_consent,
      recordingUrl: row.recording_url,
      recordingExpiresAt: row.recording_expires_at ? new Date(row.recording_expires_at as string).getTime() : null,
      googleCalendarEventId: row.google_calendar_event_id,
      notes: row.notes,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "seatReservations",
    query: `SELECT id, mentor_id, user_id, session_pack_id, seat_expires_at, grace_period_ends_at, final_warning_notification_sent_at, status FROM seat_reservations ORDER BY seat_expires_at`,
    transform: (row) => ({
      mentorId: row.mentor_id,
      userId: row.user_id,
      sessionPackId: row.session_pack_id,
      seatExpiresAt: row.seat_expires_at ? new Date(row.seat_expires_at as string).getTime() : null,
      gracePeriodEndsAt: row.grace_period_ends_at ? new Date(row.grace_period_ends_at as string).getTime() : null,
      finalWarningNotificationSentAt: row.final_warning_notification_sent_at ? new Date(row.final_warning_notification_sent_at as string).getTime() : null,
      status: row.status,
      legacyId: row.id,
    }),
  },
  {
    name: "menteeInvitations",
    query: `SELECT id, email, mentor_id, clerk_invitation_id, expires_at, status, deleted_at, created_at, updated_at FROM mentee_invitations ORDER BY created_at`,
    transform: (row) => ({
      email: row.email,
      instructorId: row.mentor_id,
      clerkInvitationId: row.clerk_invitation_id,
      expiresAt: row.expires_at ? new Date(row.expires_at as string).getTime() : null,
      status: row.status,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    }),
  },
  {
    name: "menteeSessionCounts",
    query: `SELECT id, user_id, mentor_id, session_count, notes, created_at, updated_at FROM mentee_session_counts ORDER BY created_at`,
    transform: (row) => ({
      userId: row.user_id,
      instructorId: row.mentor_id,
      sessionCount: row.session_count,
      notes: row.notes,
      createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
      legacyId: row.id,
    }),
  },
  {
    name: "videoEditorAssignments",
    query: `SELECT id, video_editor_id, instructor_id, assigned_at, assigned_by FROM video_editor_assignments ORDER BY assigned_at`,
    transform: (row) => ({
      videoEditorId: row.video_editor_id,
      instructorId: row.instructor_id,
      assignedAt: row.assigned_at ? new Date(row.assigned_at as string).getTime() : null,
      assignedBy: row.assigned_by,
      legacyId: row.id,
    }),
  },
  {
    name: "instructorUploads",
    query: `SELECT id, instructor_id, filename, original_name, content_type, size, b2_file_id, b2_upload_id, b2_part_etags, status, error_message, archived_at, s3_key, s3_url, transfer_status, transfer_retry_count, notified_at, created_at, updated_at, deleted_at FROM instructor_uploads ORDER BY created_at`,
    transform: (row) => ({
      instructorId: row.instructor_id,
      filename: row.filename,
      originalName: row.original_name,
      contentType: row.content_type,
      size: Number(row.size),
      b2FileId: row.b2_file_id,
      b2UploadId: row.b2_upload_id,
      b2PartEtags: row.b2_part_etags,
      status: row.status,
      errorMessage: row.error_message,
      archivedAt: row.archived_at ? new Date(row.archived_at as string).getTime() : null,
      s3Key: row.s3_key,
      s3Url: row.s3_url,
      transferStatus: row.transfer_status,
      transferRetryCount: row.transfer_retry_count,
      notifiedAt: row.notified_at ? new Date(row.notified_at as string).getTime() : null,
      createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
      legacyId: row.id,
    }),
  },
];

// Main function
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const exportOnly = args.includes("--export-only");
  const importOnly = args.includes("--import-only");
  
  console.log("\n=== Drizzle to Convex Migration ===");
  console.log(`Options: dry-run=${dryRun}, export-only=${exportOnly}, import-only=${importOnly}`);
  
  ensureOutputDir();
  
  if (dryRun) {
    console.log("\nDRY RUN - would export:");
    for (const t of [...simpleTables, ...dependentTables]) {
      console.log(`  - ${t.name}`);
    }
    return;
  }
  
  // Export phase
  if (!importOnly) {
    console.log("\n=== Phase 1: Export to JSONL ===");
    
    for (const table of [...simpleTables, ...dependentTables]) {
      try {
        await exportTable(table.name, table.query, table.transform);
      } catch (error) {
        console.error(`  ✗ Failed to export ${table.name}:`, error instanceof Error ? error.message : error);
      }
    }
    
    console.log("\n✓ Export complete!");
    console.log(`Files written to: ${OUTPUT_DIR}/`);
  }
  
  // Import phase
  if (!exportOnly) {
    console.log("\n=== Phase 2: Import to Convex ===");
    console.log("(Note: Requires Convex dev server running in another terminal)");
    
    for (const table of [...simpleTables, ...dependentTables]) {
      try {
        await importTable(table.name);
      } catch (error) {
        console.error(`  ✗ Failed to import ${table.name}:`, error instanceof Error ? error.message : error);
      }
    }
    
    console.log("\n✓ Import complete!");
  }
  
  console.log("\n=== Migration Complete ===");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});