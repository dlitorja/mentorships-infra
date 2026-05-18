/**
 * Drizzle to Convex Preprocessor
 * 
 * Exports data from Drizzle (PostgreSQL) and prepares it for Convex import.
 * Handles:
 * - Uses existing Drizzle connection from packages/db/src
 * - Foreign key resolution using Convex mappings
 * - JSONL output for convex import
 * 
 * Usage:
 *   npx tsx scripts/migrate-to-convex/preprocessor.ts <command> [options]
 * 
 * Commands:
 *   export <table>    - Export table from Drizzle to JSONL
 *   mappings          - Fetch all Convex mappings for FK resolution
 *   all               - Run full export for all tables
 */

import { getDb } from "../../packages/db/src";
import { sql } from "drizzle-orm";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Environment
const CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
const OUTPUT_DIR = "./migration-data";

// Debug: show what DATABASE_URL we're getting (without password)
const dbgUrl = process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@');
console.error(`DATABASE_URL: ${dbgUrl}`);

// Decode URL function for password encoding
function decodeUrl(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// Drizzle connection
const db = getDb();

// Convex mapping cache
interface ConvexMapping {
  legacyId: string;
  clerkId?: string;
  userId?: string;
  mentorId?: string;
  convexId: string;
}

interface MappingCache {
  users: Map<string, ConvexMapping>;
  instructors: Map<string, ConvexMapping>;
  orders: Map<string, ConvexMapping>;
  payments: Map<string, ConvexMapping>;
  sessionPacks: Map<string, ConvexMapping>;
}

const cache: MappingCache = {
  users: new Map(),
  instructors: new Map(),
  orders: new Map(),
  payments: new Map(),
  sessionPacks: new Map(),
};

// Fetch Convex mappings via local HTTP API
async function fetchConvexMappings(): Promise<void> {
  console.log("Fetching Convex mappings...");
  
  const endpoints = [
    { key: "users", url: `${CONVEX_URL}/api/legacyMappings/getAllUsersMappings` },
    { key: "instructors", url: `${CONVEX_URL}/api/legacyMappings/getAllInstructorsMappings` },
    { key: "orders", url: `${CONVEX_URL}/api/legacyMappings/getAllOrdersMappings` },
    { key: "payments", url: `${CONVEX_URL}/api/legacyMappings/getAllPaymentsMappings` },
    { key: "sessionPacks", url: `${CONVEX_URL}/api/legacyMappings/getAllSessionPacksMappings` },
  ];

  for (const { key, url } of endpoints) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json() as ConvexMapping[];
        const map = cache[key as keyof MappingCache];
        for (const item of data) {
          if (item.legacyId) {
            map.set(item.legacyId, item);
          }
        }
        console.log(`  ${key}: ${data.length} mappings`);
      } else {
        console.log(`  ${key}: fetch failed (${response.status}) - starting fresh`);
      }
    } catch (error) {
      console.log(`  ${key}: error - ${error instanceof Error ? error.message : error}`);
    }
  }
}

// Resolve foreign key to Convex ID
function resolveFk(table: keyof MappingCache, legacyId: string | null | undefined): string | null {
  if (!legacyId) return null;
  const mapping = cache[table].get(legacyId);
  return mapping?.convexId ?? null;
}

// Ensure output directory exists
function ensureOutputDir(): void {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

// Export users table
async function exportUsers(): Promise<void> {
  console.log("\n--- Exporting users ---");
  const result = await db.execute(sql`
    SELECT id, email, role, time_zone, created_at, updated_at, deleted_at
    FROM users
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
    userId: row.id,
    email: row.email,
    clerkId: row.id, // Drizzle users.id IS the Clerk ID
    role: row.role || "student",
    timeZone: row.time_zone || null,
    legacyId: row.id,
    // Note: firstName, lastName not in Drizzle users table - will be empty
  }));
  
  const filePath = join(OUTPUT_DIR, "users.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} users to ${filePath}`);
}

// Export instructors table (from mentors + instructorProfiles)
async function exportInstructors(): Promise<void> {
  console.log("\n--- Exporting instructors ---");
  
  // Get mentors (main instructor data)
  const mentorsResult = await db.execute(sql`
    SELECT m.id, m.user_id, m.google_calendar_id, m.google_refresh_token,
           m.time_zone, m.working_hours, m.max_active_students, m.bio, m.pricing,
           m.one_on_one_inventory, m.group_inventory, m.created_at, m.updated_at, m.deleted_at,
           u.email, u.time_zone as user_time_zone
    FROM mentors m
    LEFT JOIN users u ON m.user_id = u.id
    ORDER BY m.created_at
  `);
  const mentors = mentorsResult.rows as Record<string, unknown>[];
  
  const records = [];
  for (const m of mentors) {
    const convexUserId = resolveFk("users", m.user_id as string);
    records.push({
      userId: convexUserId || m.user_id,
      name: null, // Will be filled from instructorProfiles
      email: m.email,
      googleCalendarId: m.google_calendar_id,
      googleRefreshToken: m.google_refresh_token,
      timeZone: m.time_zone || m.user_time_zone,
      workingHours: m.working_hours,
      maxActiveStudents: m.max_active_students,
      bio: m.bio,
      pricing: m.pricing,
      oneOnOneInventory: m.one_on_one_inventory,
      groupInventory: m.group_inventory,
      mentorId: m.id,
      legacyId: m.id,
      createdAt: new Date(m.created_at as string).getTime(),
      updatedAt: new Date(m.updated_at as string).getTime(),
      deletedAt: m.deleted_at ? new Date(m.deleted_at as string).getTime() : null,
    });
  }
  
  const filePath = join(OUTPUT_DIR, "instructors.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} instructors to ${filePath}`);
}

// Export products table
async function exportProducts(): Promise<void> {
  console.log("\n--- Exporting products ---");
  const result = await db.execute(sql`
    SELECT id, mentor_id, title, description, image_url, price, currency,
           sessions_per_pack, validity_days, stripe_price_id, stripe_product_id,
           paypal_product_id, mentorship_type, active, deleted_at, created_at, updated_at
    FROM mentorship_products
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
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
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
  }));
  
  const filePath = join(OUTPUT_DIR, "products.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} products to ${filePath}`);
}

// Export orders table
async function exportOrders(): Promise<void> {
  console.log("\n--- Exporting orders ---");
  const result = await db.execute(sql`
    SELECT id, user_id, status, provider, total_amount, currency, deleted_at, created_at, updated_at
    FROM orders
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
    userId: row.user_id,
    status: row.status,
    provider: row.provider,
    totalAmount: row.total_amount,
    currency: row.currency,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
  }));
  
  const filePath = join(OUTPUT_DIR, "orders.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} orders to ${filePath}`);
}

// Export payments table
async function exportPayments(): Promise<void> {
  console.log("\n--- Exporting payments ---");
  const result = await db.execute(sql`
    SELECT id, order_id, provider, provider_payment_id, amount, currency, 
           status, refunded_amount, deleted_at, created_at, updated_at
    FROM payments
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = [];
  for (const row of rows) {
    const convexOrderId = resolveFk("orders", row.order_id as string);
    if (!convexOrderId) {
      console.warn(`  Skipping payment ${row.id}: order ${row.order_id} not found in Convex`);
      continue;
    }
    records.push({
      orderId: convexOrderId,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      refundedAmount: row.refunded_amount,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    });
  }
  
  const filePath = join(OUTPUT_DIR, "payments.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} payments to ${filePath}`);
}

// Export sessionPacks table
async function exportSessionPacks(): Promise<void> {
  console.log("\n--- Exporting sessionPacks ---");
  const result = await db.execute(sql`
    SELECT sp.id, sp.user_id, sp.mentor_id, sp.total_sessions, sp.remaining_sessions,
           sp.purchased_at, sp.expires_at, sp.status, sp.payment_id, 
           sp.deleted_at, sp.created_at, sp.updated_at
    FROM session_packs sp
    ORDER BY sp.created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = [];
  for (const row of rows) {
    // Find instructor by mentorId
    let convexMentorId: string | null = null;
    for (const [legacyId, mapping] of cache.instructors) {
      if (legacyId === row.mentor_id) {
        convexMentorId = mapping.convexId;
        break;
      }
    }
    
    // Find payment by legacyId
    let convexPaymentId: string | null = null;
    for (const [legacyId, mapping] of cache.payments) {
      if (legacyId === row.payment_id) {
        convexPaymentId = mapping.convexId;
        break;
      }
    }
    
    if (!convexMentorId || !convexPaymentId) {
      console.warn(`  Skipping sessionPack ${row.id}: instructor=${convexMentorId}, payment=${convexPaymentId}`);
      continue;
    }
    
    records.push({
      userId: row.user_id,
      mentorId: convexMentorId,
      totalSessions: row.total_sessions,
      remainingSessions: row.remaining_sessions,
      purchasedAt: new Date(row.purchased_at as string).getTime(),
      expiresAt: row.expires_at ? new Date(row.expires_at as string).getTime() : null,
      status: row.status,
      paymentId: convexPaymentId,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    });
  }
  
  const filePath = join(OUTPUT_DIR, "sessionPacks.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} sessionPacks to ${filePath}`);
}

// Export sessions table
async function exportSessions(): Promise<void> {
  console.log("\n--- Exporting sessions ---");
  const result = await db.execute(sql`
    SELECT s.id, s.mentor_id, s.student_id, s.session_pack_id, s.scheduled_at,
           s.completed_at, s.canceled_at, s.status, s.recording_consent,
           s.recording_url, s.recording_expires_at, s.google_calendar_event_id,
           s.notes, s.deleted_at, s.created_at, s.updated_at
    FROM sessions s
    ORDER BY s.scheduled_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = [];
  for (const row of rows) {
    // Find instructor by mentorId
    let convexMentorId: string | null = null;
    for (const [legacyId, mapping] of cache.instructors) {
      if (legacyId === row.mentor_id) {
        convexMentorId = mapping.convexId;
        break;
      }
    }
    
    // Find sessionPack by legacyId
    let convexSessionPackId: string | null = null;
    for (const [legacyId, mapping] of cache.sessionPacks) {
      if (legacyId === row.session_pack_id) {
        convexSessionPackId = mapping.convexId;
        break;
      }
    }
    
    if (!convexMentorId || !convexSessionPackId) {
      console.warn(`  Skipping session ${row.id}: instructor=${convexMentorId}, pack=${convexSessionPackId}`);
      continue;
    }
    
    records.push({
      mentorId: convexMentorId,
      studentId: row.student_id,
      sessionPackId: convexSessionPackId,
      scheduledAt: new Date(row.scheduled_at as string).getTime(),
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
    });
  }
  
  const filePath = join(OUTPUT_DIR, "sessions.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} sessions to ${filePath}`);
}

// Export seatReservations table
async function exportSeatReservations(): Promise<void> {
  console.log("\n--- Exporting seatReservations ---");
  const result = await db.execute(sql`
    SELECT sr.id, sr.mentor_id, sr.user_id, sr.session_pack_id, sr.seat_expires_at,
           sr.grace_period_ends_at, sr.final_warning_notification_sent_at, sr.status
    FROM seat_reservations sr
    ORDER BY sr.seat_expires_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = [];
  for (const row of rows) {
    // Find instructor by mentorId
    let convexMentorId: string | null = null;
    for (const [legacyId, mapping] of cache.instructors) {
      if (legacyId === row.mentor_id) {
        convexMentorId = mapping.convexId;
        break;
      }
    }
    
    // Find sessionPack by legacyId
    let convexSessionPackId: string | null = null;
    for (const [legacyId, mapping] of cache.sessionPacks) {
      if (legacyId === row.session_pack_id) {
        convexSessionPackId = mapping.convexId;
        break;
      }
    }
    
    if (!convexMentorId || !convexSessionPackId) {
      console.warn(`  Skipping seatReservation ${row.id}: instructor=${convexMentorId}, pack=${convexSessionPackId}`);
      continue;
    }
    
    records.push({
      mentorId: convexMentorId,
      userId: row.user_id,
      sessionPackId: convexSessionPackId,
      seatExpiresAt: new Date(row.seat_expires_at as string).getTime(),
      gracePeriodEndsAt: row.grace_period_ends_at ? new Date(row.grace_period_ends_at as string).getTime() : null,
      finalWarningNotificationSentAt: row.final_warning_notification_sent_at 
        ? new Date(row.final_warning_notification_sent_at as string).getTime() : null,
      status: row.status,
      legacyId: row.id,
    });
  }
  
  const filePath = join(OUTPUT_DIR, "seatReservations.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} seatReservations to ${filePath}`);
}

// Export contacts table
async function exportContacts(): Promise<void> {
  console.log("\n--- Exporting contacts ---");
  const result = await db.execute(sql`
    SELECT id, email, art_goals, source, opted_in, created_at, updated_at
    FROM contacts
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
    email: row.email,
    artGoals: row.art_goals,
    source: row.source,
    optedIn: row.opted_in,
    legacyId: row.id,
  }));
  
  const filePath = join(OUTPUT_DIR, "contacts.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} contacts to ${filePath}`);
}

// Export menteeInvitations table
async function exportMenteeInvitations(): Promise<void> {
  console.log("\n--- Exporting menteeInvitations ---");
  const result = await db.execute(sql`
    SELECT mi.id, mi.email, mi.mentor_id, mi.clerk_invitation_id, 
           mi.expires_at, mi.status, mi.deleted_at, mi.created_at, mi.updated_at
    FROM mentee_invitations mi
    ORDER BY mi.created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = [];
  for (const row of rows) {
    // Find instructor by mentorId
    let convexInstructorId: string | null = null;
    for (const [legacyId, mapping] of cache.instructors) {
      if (legacyId === row.mentor_id) {
        convexInstructorId = mapping.convexId;
        break;
      }
    }
    
    if (!convexInstructorId) {
      console.warn(`  Skipping menteeInvitation ${row.id}: instructor not found`);
      continue;
    }
    
    records.push({
      email: row.email,
      instructorId: convexInstructorId,
      clerkInvitationId: row.clerk_invitation_id,
      expiresAt: new Date(row.expires_at as string).getTime(),
      status: row.status,
      legacyId: row.id,
      deletedAt: row.deleted_at ? new Date(row.deleted_at as string).getTime() : null,
    });
  }
  
  const filePath = join(OUTPUT_DIR, "menteeInvitations.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} menteeInvitations to ${filePath}`);
}

// Export menteeSessionCounts table
async function exportMenteeSessionCounts(): Promise<void> {
  console.log("\n--- Exporting menteeSessionCounts ---");
  const result = await db.execute(sql`
    SELECT msc.id, msc.user_id, msc.mentor_id, msc.session_count, msc.notes,
           msc.created_at, msc.updated_at
    FROM mentee_session_counts msc
    ORDER BY msc.created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = [];
  for (const row of rows) {
    // Find instructor by mentorId
    let convexInstructorId: string | null = null;
    for (const [legacyId, mapping] of cache.instructors) {
      if (legacyId === row.mentor_id) {
        convexInstructorId = mapping.convexId;
        break;
      }
    }
    
    if (!convexInstructorId) {
      console.warn(`  Skipping menteeSessionCount ${row.id}: instructor not found`);
      continue;
    }
    
    records.push({
      userId: row.user_id,
      instructorId: convexInstructorId,
      sessionCount: row.session_count,
      notes: row.notes,
      createdAt: new Date(row.created_at as string).getTime(),
      updatedAt: new Date(row.updated_at as string).getTime(),
      legacyId: row.id,
    });
  }
  
  const filePath = join(OUTPUT_DIR, "menteeSessionCounts.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} menteeSessionCounts to ${filePath}`);
}

// Export userIdentities table
async function exportUserIdentities(): Promise<void> {
  console.log("\n--- Exporting userIdentities ---");
  const result = await db.execute(sql`
    SELECT id, user_id, provider, provider_user_id, connected_at, created_at, updated_at
    FROM user_identities
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    connectedAt: row.connected_at ? new Date(row.connected_at as string).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).getTime() : null,
    legacyId: row.id,
  }));
  
  const filePath = join(OUTPUT_DIR, "userIdentities.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} userIdentities to ${filePath}`);
}

// Export discordActionQueue table
async function exportDiscordActionQueue(): Promise<void> {
  console.log("\n--- Exporting discordActionQueue ---");
  const result = await db.execute(sql`
    SELECT id, type, status, subject_user_id, mentor_id, mentor_user_id,
           payload, attempts, last_error, locked_at, created_at, updated_at
    FROM discord_action_queue
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
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
  }));
  
  const filePath = join(OUTPUT_DIR, "discordActionQueue.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} discordActionQueue records to ${filePath}`);
}

// Export videoEditorAssignments table
async function exportVideoEditorAssignments(): Promise<void> {
  console.log("\n--- Exporting videoEditorAssignments ---");
  const result = await db.execute(sql`
    SELECT id, video_editor_id, instructor_id, assigned_at, assigned_by
    FROM video_editor_assignments
    ORDER BY assigned_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
    videoEditorId: row.video_editor_id,
    instructorId: row.instructor_id,
    assignedAt: row.assigned_at ? new Date(row.assigned_at as string).getTime() : null,
    assignedBy: row.assigned_by,
    legacyId: row.id,
  }));
  
  const filePath = join(OUTPUT_DIR, "videoEditorAssignments.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} videoEditorAssignments to ${filePath}`);
}

// Export instructorUploads table
async function exportInstructorUploads(): Promise<void> {
  console.log("\n--- Exporting instructorUploads ---");
  const result = await db.execute(sql`
    SELECT id, instructor_id, filename, original_name, content_type, size,
           b2_file_id, b2_upload_id, b2_part_etags, status, error_message,
           archived_at, s3_key, s3_url, transfer_status, transfer_retry_count,
           notified_at, created_at, updated_at, deleted_at
    FROM instructor_uploads
    ORDER BY created_at
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
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
  }));
  
  const filePath = join(OUTPUT_DIR, "instructorUploads.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} instructorUploads to ${filePath}`);
}

// Export monthlyStorageCosts table
async function exportMonthlyStorageCosts(): Promise<void> {
  console.log("\n--- Exporting monthlyStorageCosts ---");
  const result = await db.execute(sql`
    SELECT id, month, b2_storage_cost, b2_download_cost, b2_api_cost,
           s3_storage_cost, s3_retrieval_cost, total_cost, alert_sent,
           alert_threshold, created_at, updated_at
    FROM monthly_storage_costs
    ORDER BY month
  `);
  const rows = result.rows as Record<string, unknown>[];
  
  const records = rows.map((row) => ({
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
  }));
  
  const filePath = join(OUTPUT_DIR, "monthlyStorageCosts.jsonl");
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n"));
  console.log(`Exported ${records.length} monthlyStorageCosts to ${filePath}`);
}

// Main export all function
async function exportAll(): Promise<void> {
  ensureOutputDir();
  
  // Step 1: Fetch existing Convex mappings
  await fetchConvexMappings();
  
  // Step 2: Export tables in dependency order
  await exportUsers();
  
  // Refresh users mapping after first export (Convex has new IDs)
  await fetchConvexMappings();
  
  await exportInstructors();
  await exportProducts();
  await exportOrders();
  
  // Refresh orders mapping
  await fetchConvexMappings();
  
  await exportPayments();
  
  // Refresh payments mapping  
  await fetchConvexMappings();
  
  await exportSessionPacks();
  
  // Refresh sessionPacks mapping
  await fetchConvexMappings();
  
  await exportSessions();
  await exportSeatReservations();
  await exportContacts();
  await exportMenteeInvitations();
  await exportMenteeSessionCounts();
  await exportUserIdentities();
  await exportDiscordActionQueue();
  await exportVideoEditorAssignments();
  await exportInstructorUploads();
  await exportMonthlyStorageCosts();
  
  console.log("\n✓ Export complete!");
  console.log(`Data written to ${OUTPUT_DIR}/`);
  console.log("\nNext steps:");
  console.log("  1. Review JSONL files in migration-data/");
  console.log("  2. Run: npx tsx scripts/migrate-to-convex/migrate-all.ts");
}

// CLI entry point
const command = process.argv[2];

switch (command) {
  case "export":
    ensureOutputDir();
    const table = process.argv[3];
    if (!table) {
      console.error("Usage: preprocessor.ts export <table>");
      process.exit(1);
    }
    fetchConvexMappings().then(async () => {
      switch (table) {
        case "users": await exportUsers(); break;
        case "instructors": await exportInstructors(); break;
        case "products": await exportProducts(); break;
        case "orders": await exportOrders(); break;
        case "payments": await exportPayments(); break;
        case "sessionPacks": await exportSessionPacks(); break;
        case "sessions": await exportSessions(); break;
        case "seatReservations": await exportSeatReservations(); break;
        case "contacts": await exportContacts(); break;
        case "menteeInvitations": await exportMenteeInvitations(); break;
        case "menteeSessionCounts": await exportMenteeSessionCounts(); break;
        case "userIdentities": await exportUserIdentities(); break;
        case "discordActionQueue": await exportDiscordActionQueue(); break;
        case "videoEditorAssignments": await exportVideoEditorAssignments(); break;
        case "instructorUploads": await exportInstructorUploads(); break;
        case "monthlyStorageCosts": await exportMonthlyStorageCosts(); break;
        default:
          console.error(`Unknown table: ${table}`);
          process.exit(1);
      }
    });
    break;
    
  case "mappings":
    fetchConvexMappings().then(() => {
      console.log("\nMapping cache:");
      console.log(`  users: ${cache.users.size}`);
      console.log(`  instructors: ${cache.instructors.size}`);
      console.log(`  orders: ${cache.orders.size}`);
      console.log(`  payments: ${cache.payments.size}`);
      console.log(`  sessionPacks: ${cache.sessionPacks.size}`);
    });
    break;
    
  case "all":
    exportAll().then(() => process.exit(0));
    break;
    
  default:
    console.log(`
Drizzle to Convex Preprocessor

Usage:
  npx tsx scripts/migrate-to-convex/preprocessor.ts <command> [options]

Commands:
  export <table>    Export specific table to JSONL
  mappings          Fetch and display Convex mapping cache
  all               Run full export for all tables

Tables:
  users, instructors, products, orders, payments, sessionPacks,
  sessions, seatReservations, contacts, menteeInvitations,
  menteeSessionCounts, userIdentities, discordActionQueue,
  videoEditorAssignments, instructorUploads, monthlyStorageCosts
`);
    process.exit(0);
}

// Cleanup on exit
process.on("SIGINT", async () => {
  console.log("\nClosing connections...");
  process.exit(0);
});
