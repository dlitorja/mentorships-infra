/**
 * Merge instructors and legacy instructor calendar data for Convex import
 * 
 * The Convex instructors table combines:
 * - Public profile data from Supabase instructors table
 * - Internal Google Calendar/integration data from a legacy table
 * 
 * Matching is done via:
 * - instructors.mentor_id -> legacy calendar entry id (if set)
 * - instructors.user_id -> legacy calendar entry user_id (fallback)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = "./migration-data";

function loadJsonl(filename) {
  const filePath = join(OUTPUT_DIR, filename);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  if (!content.trim()) return [];
  return content.trim().split("\n").map(line => JSON.parse(line));
}

function saveJsonl(filename, data) {
  const filePath = join(OUTPUT_DIR, filename);
  writeFileSync(filePath, data.map(row => JSON.stringify(row)).join("\n"));
}

function main() {
  console.log("\n=== Merging Instructors and Calendar Data (legacy) ===\n");

  const instructors = loadJsonl("instructors.jsonl");
  // Legacy file name retained for compatibility
  const calendarData = loadJsonl("mentorData.jsonl");

  console.log(`Instructors: ${instructors.length}`);
  console.log(`Legacy calendar entries: ${calendarData.length}`);

  if (calendarData.length === 0) {
    console.log("\nNo legacy calendar data to merge, keeping instructors as-is");
    return;
  }

  // Create a map of calendar entries by their id
  const calendarById = new Map();
  const calendarByUserId = new Map();
  
  for (const entry of calendarData) {
    if (entry.mentorId) calendarById.set(entry.mentorId, entry);
    if (entry.userId) calendarByUserId.set(entry.userId, entry);
  }

  // Merge data
  const mergedInstructors = instructors.map(instructor => {
    let matchedCalendar = null;

    // Try matching via mentor_id first (legacy column)
    if (instructor.mentor_id) {
      matchedCalendar = calendarById.get(instructor.mentor_id);
    }

    // Fallback to user_id matching
    if (!matchedCalendar && instructor.user_id) {
      matchedCalendar = calendarByUserId.get(instructor.user_id);
    }

    if (matchedCalendar) {
      // Merge calendar/integration data into instructor
      return {
        ...instructor,
        mentorId: matchedCalendar.mentorId || matchedCalendar.id,
        googleCalendarId: matchedCalendar.googleCalendarId,
        googleRefreshToken: matchedCalendar.googleRefreshToken,
        timeZone: matchedCalendar.timeZone,
        workingHours: matchedCalendar.workingHours,
        maxActiveStudents: matchedCalendar.maxActiveStudents,
        bio: matchedCalendar.bio || instructor.bio,
        pricing: matchedCalendar.pricing,
        oneOnOneInventory: matchedCalendar.oneOnOneInventory,
        groupInventory: matchedCalendar.groupInventory,
        deletedAt: matchedCalendar.deletedAt,
      };
    }

    // No match found - keep instructor as-is
    return instructor;
  });

  console.log(`\nMerged: ${mergedInstructors.length} instructors`);

  // Save merged instructors
  saveJsonl("instructors.jsonl", mergedInstructors);
  console.log("Saved merged data to instructors.jsonl");

  // Remove the separate legacy calendar data file since it's now merged
  console.log("\nNote: legacy calendar data (mentorData.jsonl) is no longer needed (data merged into instructors.jsonl)");
}

main();
