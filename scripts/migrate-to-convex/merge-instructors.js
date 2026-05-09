/**
 * Merge instructors and mentors data for Convex import
 * 
 * The Convex instructors table combines:
 * - Public profile data from Supabase instructors table
 * - Internal Google Calendar data from Supabase mentors table
 * 
 * Matching is done via:
 * - instructors.mentor_id -> mentors.id (if set)
 * - instructors.user_id -> mentors.user_id (fallback)
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
  console.log("\n=== Merging Instructors and Mentors ===\n");

  const instructors = loadJsonl("instructors.jsonl");
  const mentors = loadJsonl("mentorData.jsonl");

  console.log(`Instructors: ${instructors.length}`);
  console.log(`Mentors: ${mentors.length}`);

  if (mentors.length === 0) {
    console.log("\nNo mentors to merge, keeping instructors as-is");
    return;
  }

  // Create a map of mentors by their id
  const mentorById = new Map();
  const mentorByUserId = new Map();
  
  for (const mentor of mentors) {
    if (mentor.mentorId) mentorById.set(mentor.mentorId, mentor);
    if (mentor.userId) mentorByUserId.set(mentor.userId, mentor);
  }

  // Merge data
  const mergedInstructors = instructors.map(instructor => {
    let matchedMentor = null;

    // Try matching via mentor_id first
    if (instructor.mentor_id) {
      matchedMentor = mentorById.get(instructor.mentor_id);
    }

    // Fallback to user_id matching
    if (!matchedMentor && instructor.user_id) {
      matchedMentor = mentorByUserId.get(instructor.user_id);
    }

    if (matchedMentor) {
      // Merge mentor data into instructor
      return {
        ...instructor,
        mentorId: matchedMentor.mentorId || matchedMentor.id,
        googleCalendarId: matchedMentor.googleCalendarId,
        googleRefreshToken: matchedMentor.googleRefreshToken,
        timeZone: matchedMentor.timeZone,
        workingHours: matchedMentor.workingHours,
        maxActiveStudents: matchedMentor.maxActiveStudents,
        bio: matchedMentor.bio || instructor.bio, // Keep instructor bio if mentor bio is generic
        pricing: matchedMentor.pricing,
        oneOnOneInventory: matchedMentor.oneOnOneInventory,
        groupInventory: matchedMentor.groupInventory,
        deletedAt: matchedMentor.deletedAt,
      };
    }

    // No match found - keep instructor as-is
    return instructor;
  });

  console.log(`\nMerged: ${mergedInstructors.length} instructors`);

  // Save merged instructors
  saveJsonl("instructors.jsonl", mergedInstructors);
  console.log("Saved merged data to instructors.jsonl");

  // Remove the separate mentorData file since it's now merged
  console.log("\nNote: mentorData.jsonl is no longer needed (data merged into instructors.jsonl)");
}

main();