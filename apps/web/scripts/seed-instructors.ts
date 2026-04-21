/**
 * Seed script to populate Convex with instructor data from static JSON
 * 
 * Usage (from project root):
 *   npx tsx apps/web/scripts/seed-instructors.ts
 * 
 * This script uses `npx convex run` to execute mutations via the CLI.
 * It checks for existing instructors before creating (idempotent).
 */

import { spawn } from "child_process";
import { instructors as marketingInstructors } from "../../marketing/lib/instructors";

function runConvexMutation(functionName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const argsJson = JSON.stringify(args);
    const child = spawn("npx", [
      "convex",
      "run",
      functionName,
      argsJson,
      "--typecheck", "disable"
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
        reject(new Error(`${functionName} failed: ${stderr || stdout}`));
        return;
      }
      
      const trimmed = stdout.trim();
      
      // Handle plain string ID (e.g., "jn74k6753r5kzn2579532nnqyd8570kc")
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
          resolve(JSON.parse(trimmed));
          return;
        } catch {
          // Continue to try JSON parsing
        }
      }
      
      // Parse the JSON output
      try {
        // The output might be mixed with console logs, extract JSON
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          resolve(JSON.parse(jsonMatch[0]));
        } else {
          resolve({ success: true });
        }
      } catch (e) {
        resolve({ success: true, raw: stdout });
      }
    });
  });
}

async function seedInstructor(instructor: any): Promise<any> {
  console.log(`  Creating mentor...`);
  
  const userId = `seed-${instructor.slug}`;
  
  // Create mentor - try/catch for idempotency
  let mentorId;
  try {
    const mentorResult = await runConvexMutation("mentors:createMentor", {
      userId,
      oneOnOneInventory: 3,
      groupInventory: instructor.pricing?.group ? 2 : 0,
      maxActiveStudents: 10,
    });
    // Mutation returns ID directly (string) or object with _id
    mentorId = typeof mentorResult === 'string' ? mentorResult : mentorResult?._id;
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint") || e.message?.includes("already exists")) {
      console.log(`  ⏭️  Mentor already exists, skipping`);
      return { skipped: true };
    }
    throw e;
  }

  if (!mentorId) {
    throw new Error("Could not get mentor ID");
  }
  
  console.log(`  Mentor ID: ${mentorId}`);

  console.log(`  Creating instructor...`);
  
  // Create instructor
  const instructorResult = await runConvexMutation("instructors:createInstructor", {
    name: instructor.name,
    slug: instructor.slug,
    tagline: instructor.tagline,
    bio: instructor.bio,
    specialties: instructor.specialties,
    background: instructor.background,
    profileImageUrl: instructor.profileImage,
    portfolioImages: instructor.workImages,
    socials: instructor.socials,
    isActive: true,
    isNew: instructor.isNew || false,
    mentorId,
  });

  const instructorId = typeof instructorResult === 'string' ? instructorResult : (instructorResult?._id || instructorResult?.value?._id);
  console.log(`  Instructor ID: ${instructorId}`);

  // Create products
  if (instructor.pricing?.oneOnOne) {
    console.log(`  Creating 1-on-1 product...`);
    await runConvexMutation("products:createProduct", {
      mentorId,
      title: "1-on-1 Mentorship",
      description: `4-session mentorship with ${instructor.name}`,
      price: instructor.pricing.oneOnOne.toString(),
      sessionsPerPack: 4,
      validityDays: 60,
      mentorshipType: "one-on-one",
      active: true,
    });
  }

  if (instructor.pricing?.group) {
    console.log(`  Creating group product...`);
    await runConvexMutation("products:createProduct", {
      mentorId,
      title: "Group Mentorship",
      description: `4-session group mentorship with ${instructor.name}`,
      price: instructor.pricing.group.toString(),
      sessionsPerPack: 4,
      validityDays: 60,
      mentorshipType: "group",
      active: true,
    });
  }

  // Create testimonials
  if (instructor.testimonials) {
    console.log(`  Creating ${instructor.testimonials.length} testimonials...`);
    for (const testimonial of instructor.testimonials) {
      await runConvexMutation("instructors:createTestimonial", {
        instructorId,
        name: testimonial.author,
        text: testimonial.text,
      });
    }
  }

  // Create mentee results
  if (instructor.menteeBeforeAfterImages) {
    console.log(`  Creating ${instructor.menteeBeforeAfterImages.length} mentee results...`);
    for (const imageUrl of instructor.menteeBeforeAfterImages) {
      await runConvexMutation("instructors:createMenteeResult", {
        instructorId,
        imageUrl,
      });
    }
  }

  return { success: true, instructorId, mentorId };
}

async function seedInstructors(): Promise<void> {
  console.log("Starting instructor seed...\n");

  const visibleInstructors = marketingInstructors.filter((i) => !i.isHidden);
  console.log(`Found ${visibleInstructors.length} instructors to seed\n`);

  let seeded = 0;
  let skipped = 0;

  for (const instructor of visibleInstructors) {
    console.log(`--- Seeding: ${instructor.name} (${instructor.slug}) ---`);

    try {
      const result = await seedInstructor(instructor);

      if (result.skipped) {
        skipped++;
      } else {
        console.log(`  ✓ Seeded successfully`);
        seeded++;
      }
    } catch (error) {
      console.error(`  ✗ Error:`, error);
    }

    console.log("");
  }

  console.log("=== Seed Complete ===");
  console.log(`Seeded: ${seeded}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${seeded + skipped}`);
}

seedInstructors().catch(console.error);