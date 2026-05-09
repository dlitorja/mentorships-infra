/**
 * Export from Supabase REST API and prepare for Convex import
 * 
 * Tables discovered in Supabase:
 * - users (11 rows)
 * - mentorship_products (0 rows)
 * - orders (5 rows)
 * - payments (2 rows)
 * - user_identities (2 rows)
 * - discord_action_queue (3 rows)
 * - mentors (0 rows)
 * - instructors (15 rows)
 * - session_packs (2 rows)
 * - seat_reservations (1 row)
 * - mentee_invitations (empty)
 * - free_mentorship_signups (13 rows)
 * - marketing_waitlist (7 rows)
 * - admin_digest_settings (1 row)
 * - instructor_testimonials (empty)
 * - mentee_results (empty)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const SB_API_KEY = process.env.SB_API_KEY;
const SB_PROJECT = "ytxtlscmxyqomxhripki";
const SB_URL = `https://${SB_PROJECT}.supabase.co`;
const OUTPUT_DIR = "./migration-data";

function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function fetchTable(tableName, columns = "*") {
  let offset = 0;
  const limit = 1000;
  let allRows = [];

  while (true) {
    const url = `${SB_URL}/rest/v1/${tableName}?select=${columns}&offset=${offset}&limit=${limit}`;
    
    const response = await fetch(url, {
      headers: {
        "apikey": SB_API_KEY,
        "Authorization": `Bearer ${SB_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch ${tableName}: ${response.status} ${error}`);
    }

    const rows = await response.json();
    
    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    allRows = allRows.concat(rows);
    
    if (rows.length < limit) {
      break;
    }
    
    offset += limit;
  }

  return allRows;
}

async function fetchTableWithPagination(tableName, columns = "*") {
  let page = 0;
  const pageSize = 1000;
  let allRows = [];
  let hasMore = true;

  while (hasMore) {
    const offset = page * pageSize;
    const url = `${SB_URL}/rest/v1/${tableName}?select=${columns}&offset=${offset}&limit=${pageSize}`;
    
    const response = await fetch(url, {
      headers: {
        "apikey": SB_API_KEY,
        "Authorization": `Bearer ${SB_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch ${tableName}: ${response.status} ${error}`);
    }

    const rows = await response.json();
    
    if (!Array.isArray(rows) || rows.length === 0) {
      hasMore = false;
      break;
    }

    allRows = allRows.concat(rows);
    
    if (rows.length < pageSize) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allRows;
}

// Transform functions
function transformUsers(rows) {
  return rows.map(row => ({
    userId: row.id,
    email: row.email,
    clerkId: row.id,
    firstName: null,
    lastName: null,
    role: row.role || "student",
    timeZone: row.time_zone,
    legacyId: row.id,
  }));
}

function transformOrders(rows) {
  return rows.map(row => ({
    userId: row.user_id,
    status: row.status,
    provider: row.provider,
    totalAmount: row.total_amount,
    currency: row.currency,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  }));
}

function transformPayments(rows) {
  return rows.map(row => ({
    orderId: row.order_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    refundedAmount: row.refunded_amount,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  }));
}

function transformUserIdentities(rows) {
  return rows.map(row => ({
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    connectedAt: row.connected_at ? new Date(row.connected_at).getTime() : null,
    legacyId: row.id,
  }));
}

function transformDiscordActionQueue(rows) {
  return rows.map(row => ({
    type: row.type,
    status: row.status,
    subjectUserId: row.subject_user_id,
    mentorId: row.mentor_id,
    mentorUserId: row.mentor_user_id,
    payload: row.payload,
    attempts: row.attempts,
    lastError: row.last_error,
    lockedAt: row.locked_at ? new Date(row.locked_at).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    legacyId: row.id,
  }));
}

// instructors table - public profile data (NOT mentors!)
function transformInstructors(rows) {
  return rows.map(row => ({
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    email: row.email,
    tagline: row.tagline,
    bio: row.bio,
    specialties: row.specialties,
    background: row.background,
    profileImageUrl: row.profile_image_url,
    portfolioImages: row.portfolio_images,
    socials: row.socials,
    isActive: row.is_active,
    legacyId: row.id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
  }));
}

// mentors table - internal data with Google Calendar integration
function transformMentors(rows) {
  return rows.map(row => ({
    userId: row.user_id,
    mentorId: row.id,
    googleCalendarId: row.google_calendar_id,
    googleRefreshToken: row.google_refresh_token,
    timeZone: row.time_zone,
    workingHours: row.working_hours,
    maxActiveStudents: row.max_active_students,
    bio: row.bio,
    pricing: row.pricing,
    oneOnOneInventory: row.one_on_one_inventory,
    groupInventory: row.group_inventory,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  }));
}

function transformSessionPacks(rows) {
  return rows.map(row => ({
    userId: row.user_id,
    mentorId: row.mentor_id,
    totalSessions: row.total_sessions,
    remainingSessions: row.remaining_sessions,
    purchasedAt: row.purchased_at ? new Date(row.purchased_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    status: row.status,
    paymentId: row.payment_id,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  }));
}

// Note: sessions table in Supabase seems empty or has different schema
function transformSessions(rows) {
  return rows.map(row => ({
    mentorId: row.mentor_id,
    studentId: row.student_id,
    sessionPackId: row.session_pack_id,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).getTime() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    canceledAt: row.canceled_at ? new Date(row.canceled_at).getTime() : null,
    status: row.status,
    recordingConsent: row.recording_consent || false,
    recordingUrl: row.recording_url,
    recordingExpiresAt: row.recording_expires_at ? new Date(row.recording_expires_at).getTime() : null,
    googleCalendarEventId: row.google_calendar_event_id,
    notes: row.notes,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  }));
}

function transformSeatReservations(rows) {
  return rows.map(row => ({
    mentorId: row.mentor_id,
    userId: row.user_id,
    sessionPackId: row.session_pack_id,
    seatExpiresAt: row.seat_expires_at ? new Date(row.seat_expires_at).getTime() : null,
    gracePeriodEndsAt: row.grace_period_ends_at ? new Date(row.grace_period_ends_at).getTime() : null,
    finalWarningNotificationSentAt: row.final_warning_notification_sent_at ? new Date(row.final_warning_notification_sent_at).getTime() : null,
    status: row.status,
    legacyId: row.id,
  }));
}

function transformMenteeInvitations(rows) {
  return rows.map(row => ({
    email: row.email,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    status: row.status,
    clerkInvitationId: row.clerk_invitation_id,
    legacyId: row.id,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  }));
}

// free_mentorship_signups - matches video_editor_assignments in Convex schema
function transformVideoEditorAssignments(rows) {
  return rows.map(row => ({
    name: row.name,
    email: row.email,
    portfolioUrl: row.portfolio_url,
    timeZone: row.time_zone,
    artGoals: row.art_goals,
    instructorSlug: row.instructor_slug,
    consent: row.consent,
    consentTimestamp: row.consent_timestamp ? new Date(row.consent_timestamp).getTime() : null,
    legacyId: row.id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  }));
}

function transformMarketingWaitlist(rows) {
  return rows.map(row => ({
    email: row.email,
    instructorSlug: row.instructor_slug,
    mentorshipType: row.mentorship_type,
    notified: row.notified,
    lastNotificationAt: row.last_notification_at ? new Date(row.last_notification_at).getTime() : null,
    legacyId: row.id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
  }));
}

function transformAdminDigestSettings(rows) {
  return rows.map(row => ({
    id: row.id,
    enabled: row.enabled,
    frequency: row.frequency,
    adminEmail: row.admin_email,
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
  }));
}

function transformMenteeResults(rows) {
  return rows.map(row => ({
    instructorId: row.instructor_id,
    imageUrl: row.image_url,
    imageUploadPath: row.image_upload_path,
    studentName: row.student_name,
    createdBy: row.created_by,
    legacyId: row.id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  }));
}

function transformInstructorTestimonials(rows) {
  return rows.map(row => ({
    instructorId: row.instructor_id,
    name: row.name,
    text: row.text,
    legacyId: row.id,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  }));
}

// Table configurations - use actual Supabase table names
const tableConfigs = [
  // Users - export first as it's a dependency
  { 
    name: "users", 
    columns: "id,email,role,time_zone,created_at,updated_at,deleted_at", 
    transform: transformUsers,
    targetName: "users"
  },
  
  // Instructors (public profile data)
  { 
    name: "instructors", 
    columns: "id,user_id,name,slug,email,tagline,bio,specialties,background,profile_image_url,portfolio_images,socials,is_active,created_at,updated_at", 
    transform: transformInstructors,
    targetName: "instructors"
  },
  
  // Mentors (internal data with Google Calendar info)
  { 
    name: "mentors", 
    columns: "id,user_id,google_calendar_id,google_refresh_token,time_zone,working_hours,max_active_students,bio,pricing,one_on_one_inventory,group_inventory,created_at,updated_at,deleted_at", 
    transform: transformMentors,
    targetName: "mentorData" // Store separately since Convex schema combines with instructors
  },
  
  // Orders
  { 
    name: "orders", 
    columns: "id,user_id,status,provider,total_amount,currency,created_at,updated_at,deleted_at", 
    transform: transformOrders,
    targetName: "orders"
  },
  
  // Payments
  { 
    name: "payments", 
    columns: "id,order_id,provider,provider_payment_id,amount,currency,status,refunded_amount,created_at,updated_at,deleted_at", 
    transform: transformPayments,
    targetName: "payments"
  },
  
  // Session Packs
  { 
    name: "session_packs", 
    columns: "id,user_id,mentor_id,total_sessions,remaining_sessions,purchased_at,expires_at,status,payment_id,created_at,updated_at,deleted_at", 
    transform: transformSessionPacks,
    targetName: "sessionPacks"
  },
  
  // Seat Reservations
  { 
    name: "seat_reservations", 
    columns: "id,mentor_id,user_id,session_pack_id,seat_expires_at,grace_period_ends_at,final_warning_notification_sent_at,status", 
    transform: transformSeatReservations,
    targetName: "seatReservations"
  },
  
  // Sessions (may be empty based on earlier check)
  { 
    name: "sessions", 
    columns: "id,mentor_id,student_id,session_pack_id,scheduled_at,completed_at,canceled_at,status,recording_consent,recording_url,recording_expires_at,google_calendar_event_id,notes,created_at,updated_at,deleted_at", 
    transform: transformSessions,
    targetName: "sessions"
  },
  
  // User Identities
  { 
    name: "user_identities", 
    columns: "id,user_id,provider,provider_user_id,connected_at,created_at,updated_at", 
    transform: transformUserIdentities,
    targetName: "userIdentities"
  },
  
  // Discord Action Queue
  { 
    name: "discord_action_queue", 
    columns: "id,type,status,subject_user_id,mentor_id,mentor_user_id,payload,attempts,last_error,locked_at,created_at,updated_at", 
    transform: transformDiscordActionQueue,
    targetName: "discordActionQueue"
  },
  
  // Free Mentorship Signups (replaces video_editor_assignments)
  { 
    name: "free_mentorship_signups", 
    columns: "id,name,email,portfolio_url,time_zone,art_goals,instructor_slug,consent,consent_timestamp,created_at,updated_at", 
    transform: transformVideoEditorAssignments,
    targetName: "videoEditorAssignments" // Maps to Convex table
  },
  
  // Marketing Waitlist
  { 
    name: "marketing_waitlist", 
    columns: "id,email,instructor_slug,mentorship_type,notified,last_notification_at,created_at,updated_at", 
    transform: transformMarketingWaitlist,
    targetName: "waitlist"
  },
  
  // Admin Digest Settings
  { 
    name: "admin_digest_settings", 
    columns: "id,enabled,frequency,admin_email,last_sent_at,updated_at", 
    transform: transformAdminDigestSettings,
    targetName: "adminDigestSettings"
  },
  
  // Instructor Testimonials
  { 
    name: "instructor_testimonials", 
    columns: "id,instructor_id,name,text,created_at", 
    transform: transformInstructorTestimonials,
    targetName: "instructorTestimonials"
  },
  
  // Mentee Results
  { 
    name: "mentee_results", 
    columns: "id,instructor_id,image_url,image_upload_path,student_name,created_by,created_at", 
    transform: transformMenteeResults,
    targetName: "menteeResults"
  },
];

async function exportTable(config) {
  console.log(`Exporting ${config.name} -> ${config.targetName}...`);
  try {
    const rows = await fetchTableWithPagination(config.name, config.columns);
    const transformed = config.transform(rows);
    
    const filePath = join(OUTPUT_DIR, `${config.targetName}.jsonl`);
    writeFileSync(filePath, transformed.map(r => JSON.stringify(r)).join("\n"));
    
    console.log(`  ✓ ${transformed.length} rows exported to ${config.targetName}.jsonl`);
    return transformed.length;
  } catch (error) {
    console.error(`  ✗ Failed to export ${config.name}:`, error.message);
    return 0;
  }
}

async function main() {
  if (!SB_API_KEY) {
    console.error("SB_API_KEY environment variable is required");
    process.exit(1);
  }

  ensureOutputDir();

  console.log("\n=== Supabase to Convex Migration ===\n");
  console.log(`Project: ${SB_PROJECT}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  console.log("=== Phase 1: Export to JSONL ===\n");
  
  let totalExported = 0;
  for (const config of tableConfigs) {
    const count = await exportTable(config);
    totalExported += count;
  }

  console.log(`\n✓ Export complete! Total rows: ${totalExported}`);
  console.log(`Files written to: ${OUTPUT_DIR}/`);
  console.log("\nNext steps:");
  console.log("1. Review the JSONL files in ./migration-data/");
  console.log("2. Run 'npx convex import --table <table> --replace ./migration-data/<table>.jsonl' for each table");
  console.log("3. Or run the import script to import all tables to Convex");
}

main().catch(console.error);