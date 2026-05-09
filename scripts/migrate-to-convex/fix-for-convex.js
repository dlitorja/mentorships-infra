/**
 * Fix JSONL files to match Convex schema exactly
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = "./migration-data";

// Fields allowed per Convex table (based on schema inspection)
const ALLOWED_FIELDS = {
  users: ["userId", "email", "clerkId", "firstName", "lastName", "role", "timeZone", "legacyId"],
  instructors: [
    "userId", "name", "slug", "email", "googleCalendarId", "googleRefreshToken",
    "timeZone", "workingHours", "maxActiveStudents", "bio", "pricing",
    "oneOnOneInventory", "groupInventory", "deletedAt", "legacyId", "isActive",
    "isNew", "background", "specialties", "portfolioImages", "portfolioImageStorageIds",
    "profileImageUrl", "profileImageStorageId", "profileImageUploadPath",
    "socials", "mentorId", "tagline", "updatedAt"
  ],
  orders: ["userId", "status", "provider", "totalAmount", "currency", "deletedAt", "legacyId"],
  payments: ["orderId", "provider", "providerPaymentId", "amount", "currency", "status", "refundedAmount", "deletedAt", "legacyId"],
  sessionPacks: ["userId", "mentorId", "totalSessions", "remainingSessions", "purchasedAt", "expiresAt", "status", "paymentId", "deletedAt", "legacyId"],
  seatReservations: ["mentorId", "userId", "sessionPackId", "seatExpiresAt", "gracePeriodEndsAt", "finalWarningNotificationSentAt", "status", "legacyId"],
  sessions: ["mentorId", "studentId", "sessionPackId", "scheduledAt", "completedAt", "canceledAt", "status", "recordingConsent", "recordingUrl", "recordingExpiresAt", "googleCalendarEventId", "notes", "deletedAt", "legacyId"],
  discordActionQueue: ["type", "status", "subjectUserId", "mentorId", "mentorUserId", "payload", "attempts", "lastError", "lockedAt", "createdAt", "updatedAt", "legacyId"],
  videoEditorAssignments: ["name", "email", "portfolioUrl", "timeZone", "artGoals", "instructorSlug", "consent", "consentTimestamp", "legacyId", "createdAt"],
  waitlist: ["email", "instructorSlug", "mentorshipType", "notified", "lastNotificationAt", "legacyId", "createdAt", "updatedAt"],
  adminDigestSettings: ["id", "enabled", "frequency", "adminEmail", "lastSentAt", "updatedAt"],
  instructorTestimonials: ["instructorId", "name", "text", "legacyId", "createdAt"],
  menteeResults: ["instructorId", "imageUrl", "imageUploadPath", "studentName", "createdBy", "legacyId", "createdAt"],
};

function fixFile(filename, allowedFields) {
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
    const cleaned = {};
    
    for (const key of allowedFields) {
      if (key in obj && obj[key] !== null) {
        cleaned[key] = obj[key];
      }
    }
    
    return JSON.stringify(cleaned);
  });
  
  writeFileSync(filePath, fixed.join("\n"));
  console.log(`${filename}: fixed ${lines.length} rows, allowed fields: ${allowedFields.length}`);
}

function main() {
  console.log("\n=== Fixing JSONL files to match Convex schema ===\n");
  
  for (const [filename, fields] of Object.entries(ALLOWED_FIELDS)) {
    fixFile(`${filename}.jsonl`, fields);
  }
  
  console.log("\n✓ All files fixed to match Convex schema!");
}

main();