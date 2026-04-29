/**
 * Migrate instructor data from apps/marketing/lib/instructors.ts to Convex
 *
 * Usage (from project root):
 *   npx tsx scripts/migrate-instructors-to-convex.ts
 *
 * This script uses `npx convex run` to execute upsert mutations via the CLI.
 * It is idempotent - safe to re-run.
 */

import { spawn } from 'child_process';
import { instructors as marketingInstructors } from '../apps/marketing/lib/instructors';
import type { Instructor, Testimonial } from '../apps/marketing/lib/instructors';

function runConvexMutation(functionName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const argsJson = JSON.stringify(args);
    const child = spawn('npx', [
      'convex',
      'run',
      functionName,
      argsJson,
      '--typecheck', 'disable',
      '--deployment', 'prod'
    ], {
      cwd: process.cwd(),
      shell: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${functionName} failed: ${stderr || stdout}`));
        return;
      }

      const trimmed = stdout.trim();

      if (trimmed.startsWith('\"') && trimmed.endsWith('\"')) {
        try {
          resolve(JSON.parse(trimmed));
          return;
        } catch {
          // Continue to try JSON parsing
        }
      }

      try {
        const lines = stdout.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              resolve(JSON.parse(trimmed));
              return;
            } catch {
              // continue
            }
          }
        }
        resolve({ success: true, raw: stdout });
      } catch (e) {
        resolve({ success: true, raw: stdout });
      }
    });
  });
}

function mapSocials(socials?: { platform: string; url: string }[]): Record<string, string> | undefined {
  if (!socials || socials.length === 0) return undefined;
  const mapped: Record<string, string> = {};
  for (const s of socials) {
    mapped[s.platform.toLowerCase()] = s.url;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

async function upsertInstructorProfile(instructor: Instructor): Promise<void> {
  const isActive = !instructor.isHidden;

  await runConvexMutation('instructors:upsertInstructorProfile', {
    slug: instructor.slug,
    name: instructor.name,
    tagline: instructor.tagline,
    bio: instructor.bio,
    specialties: instructor.specialties,
    background: instructor.background,
    profileImageUrl: instructor.profileImage,
    portfolioImages: instructor.workImages,
    socials: mapSocials(instructor.socials),
    isActive,
    isNew: instructor.isNew ?? false,
  });
}

async function upsertTestimonial(instructorId: string, testimonial: Testimonial): Promise<void> {
  await runConvexMutation('instructors:upsertInstructorTestimonial', {
    instructorId,
    name: testimonial.author,
    text: testimonial.text,
    role: testimonial.role,
  });
}

async function upsertMenteeResult(instructorId: string, imageUrl: string): Promise<void> {
  await runConvexMutation('instructors:upsertMenteeResult', {
    instructorId,
    imageUrl,
    studentName: undefined,
  });
}

async function migrate(): Promise<void> {
  const visibleInstructors = marketingInstructors.filter(i => !i.isHidden);

  console.log(`Migrating ${visibleInstructors.length} visible instructors to Convex...\n`);

  let profilesCreated = 0;
  let testimonialsCreated = 0;
  let menteeResultsCreated = 0;
  let errors = 0;

  for (const instructor of visibleInstructors) {
    console.log(`\n[${instructor.slug}] ${instructor.name}`);

    try {
      console.log('  - Upserting instructor profile...');
      await upsertInstructorProfile(instructor);
      profilesCreated++;
      console.log('    ✓ Profile upserted');
    } catch (e: any) {
      console.error(`    ✗ Profile failed: ${e.message}`);
      errors++;
      continue;
    }

    if (instructor.testimonials && instructor.testimonials.length > 0) {
      console.log(`  - Upserting ${instructor.testimonials.length} testimonials...`);
      for (const testimonial of instructor.testimonials) {
        try {
          await upsertTestimonial(instructor.slug, testimonial);
          testimonialsCreated++;
        } catch (e: any) {
          console.error(`    ✗ Testimonial failed: ${e.message}`);
          errors++;
        }
      }
      console.log(`    ✓ ${instructor.testimonials.length} testimonials upserted`);
    }

    if (instructor.menteeBeforeAfterImages && instructor.menteeBeforeAfterImages.length > 0) {
      console.log(`  - Upserting ${instructor.menteeBeforeAfterImages.length} mentee results...`);
      for (const imageUrl of instructor.menteeBeforeAfterImages) {
        try {
          await upsertMenteeResult(instructor.slug, imageUrl);
          menteeResultsCreated++;
        } catch (e: any) {
          console.error(`    ✗ Mentee result failed: ${e.message}`);
          errors++;
        }
      }
      console.log(`    ✓ ${instructor.menteeBeforeAfterImages.length} mentee results upserted`);
    }
  }

  console.log('\n========================================');
  console.log(`Migration complete:`);
  console.log(`  - ${profilesCreated} instructor profiles`);
  console.log(`  - ${testimonialsCreated} testimonials`);
  console.log(`  - ${menteeResultsCreated} mentee results`);
  console.log(`  - ${errors} errors`);
  console.log('========================================\n');
}

migrate().catch(console.error).finally(() => process.exit(0));