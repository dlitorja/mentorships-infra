import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import * as fs from "fs";
import * as path from "path";

const api = anyApi;

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
const LOCAL_IMAGES_BASE = path.join(process.cwd(), "apps/marketing/public");

function getLocalFilePath(imagePath) {
  if (imagePath.startsWith("/")) {
    imagePath = imagePath.substring(1);
  }
  return path.join(LOCAL_IMAGES_BASE, imagePath);
}

async function uploadToConvex(convex, arrayBuffer) {
  const uploadUrl = await convex.mutation(api.instructors.generateInstructorUploadUrl, {});

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    body: arrayBuffer,
    headers: { "Content-Type": "image/jpeg" },
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Failed to upload to Convex: ${uploadResponse.status} ${errorText}`);
  }

  return uploadResponse.json();
}

async function getStorageUrl(convex, storageId) {
  return await convex.query(api.instructors.getStorageUrl, { storageId });
}

async function migrateInstructors(convex) {
  console.log("\n=== Migrating instructors ===");

  const instructors = await convex.query(api.instructors.listInstructorsInternal, {});

  console.log(`Found ${instructors.length} instructors`);

  for (const instructor of instructors) {
    console.log(`\nProcessing instructor: ${instructor.name || instructor.slug} (${instructor._id})`);

    if (instructor.profileImageUrl && !instructor.profileImageStorageId) {
      const localPath = getLocalFilePath(instructor.profileImageUrl);
      if (fs.existsSync(localPath)) {
        try {
          console.log(`  Migrating profile image from: ${localPath}`);
          const arrayBuffer = fs.readFileSync(localPath);
          const { storageId } = await uploadToConvex(convex, arrayBuffer);
          const url = await getStorageUrl(convex, storageId);

          await convex.mutation(api.instructors.updateInstructorProfileStorageId, {
            instructorId: instructor._id,
            storageId,
            url: url || instructor.profileImageUrl,
          });

          if (instructor.slug) {
            try {
              await convex.mutation(api.instructors.updateInstructorProfileStorageIdForProfile, {
                slug: instructor.slug,
                storageId,
                url: url || instructor.profileImageUrl,
              });
              console.log(`  Updated instructorProfiles as well`);
            } catch (e) {
              console.warn(`    Could not update instructorProfiles: ${e.message}`);
            }
          }

          console.log(`  Profile image migrated: storageId=${storageId}`);
        } catch (err) {
          console.error(`  Error migrating profile image: ${err.message}`);
        }
      } else {
        console.log(`  Profile image NOT FOUND at: ${localPath}`);
      }
    } else if (instructor.profileImageStorageId) {
      console.log(`  Profile image already migrated`);
    } else {
      console.log(`  No profile image to migrate`);
    }

    if (instructor.portfolioImages && instructor.portfolioImages.length > 0) {
      const currentStorageIds = instructor.portfolioImageStorageIds || [];
      const newStorageIds = [...currentStorageIds];
      const newUrls = [...instructor.portfolioImages];

      for (let i = 0; i < instructor.portfolioImages.length; i++) {
        const imageUrl = instructor.portfolioImages[i];
        if (!imageUrl) continue;

        const existingStorageId = currentStorageIds[i];
        if (existingStorageId) {
          console.log(`  Portfolio ${i}: already migrated (storageId=${existingStorageId})`);
          continue;
        }

        const localPath = getLocalFilePath(imageUrl);
        if (!fs.existsSync(localPath)) {
          console.log(`  Portfolio ${i} NOT FOUND at: ${localPath}`);
          continue;
        }

        try {
          console.log(`  Migrating portfolio image ${i} from: ${localPath}`);
          const arrayBuffer = fs.readFileSync(localPath);
          const { storageId } = await uploadToConvex(convex, arrayBuffer);
          const url = await getStorageUrl(convex, storageId);

          while (newStorageIds.length <= i) {
            newStorageIds.push("");
          }
          while (newUrls.length <= i) {
            newUrls.push("");
          }

          newStorageIds[i] = storageId;
          newUrls[i] = url || imageUrl;

          console.log(`  Portfolio ${i} migrated: storageId=${storageId}`);
        } catch (err) {
          console.error(`  Error migrating portfolio image ${i}: ${err.message}`);
        }
      }

      try {
        await convex.mutation(api.instructors.updateInstructorPortfolioStorageIds, {
          instructorId: instructor._id,
          storageIds: newStorageIds,
          urls: newUrls,
        });
        console.log(`  Updated portfolio storage IDs`);

        if (instructor.slug) {
          try {
            const profile = await convex.query(api.instructors.getInstructorBySlug, { slug: instructor.slug });
            if (profile) {
              await convex.mutation(api.instructors.updateInstructorPortfolioStorageIdsForProfile, {
                slug: instructor.slug,
                storageIds: newStorageIds,
                urls: newUrls,
              });
              console.log(`  Updated instructorProfiles portfolio as well`);
            }
          } catch (e) {
            console.warn(`    Could not update instructorProfiles portfolio: ${e.message}`);
          }
        }
      } catch (err) {
        console.error(`  Error updating portfolio storage IDs: ${err.message}`);
      }
    }
  }

  console.log("\nInstructor migration complete!");
}

async function migrateInstructorProfiles(convex) {
  console.log("\n=== Migrating instructorProfiles ===");

  const profiles = await convex.query(api.instructors.listInstructorProfilesInternal, {});

  console.log(`Found ${profiles.length} profiles`);

  for (const profile of profiles) {
    console.log(`\nProcessing profile: ${profile.name || profile.slug} (${profile._id})`);

    if (profile.profileImageUrl && !profile.profileImageStorageId) {
      const localPath = getLocalFilePath(profile.profileImageUrl);
      if (fs.existsSync(localPath)) {
        try {
          console.log(`  Migrating profile image from: ${localPath}`);
          const arrayBuffer = fs.readFileSync(localPath);
          const { storageId } = await uploadToConvex(convex, arrayBuffer);
          const url = await getStorageUrl(convex, storageId);

          await convex.mutation(api.instructors.updateInstructorProfileStorageIdForProfile, {
            slug: profile.slug,
            storageId,
            url: url || profile.profileImageUrl,
          });

          console.log(`  Profile image migrated: storageId=${storageId}`);
        } catch (err) {
          console.error(`  Error migrating profile image: ${err.message}`);
        }
      } else {
        console.log(`  Profile image NOT FOUND at: ${localPath}`);
      }
    }

    if (profile.portfolioImages && profile.portfolioImages.length > 0) {
      const currentStorageIds = profile.portfolioImageStorageIds || [];
      const newStorageIds = [...currentStorageIds];
      const newUrls = [...profile.portfolioImages];

      for (let i = 0; i < profile.portfolioImages.length; i++) {
        const imageUrl = profile.portfolioImages[i];
        if (!imageUrl) continue;

        const existingStorageId = currentStorageIds[i];
        if (existingStorageId) continue;

        const localPath = getLocalFilePath(imageUrl);
        if (!fs.existsSync(localPath)) {
          console.log(`  Portfolio ${i} NOT FOUND at: ${localPath}`);
          continue;
        }

        try {
          console.log(`  Migrating portfolio image ${i} from: ${localPath}`);
          const arrayBuffer = fs.readFileSync(localPath);
          const { storageId } = await uploadToConvex(convex, arrayBuffer);
          const url = await getStorageUrl(convex, storageId);

          while (newStorageIds.length <= i) {
            newStorageIds.push("");
          }
          while (newUrls.length <= i) {
            newUrls.push("");
          }

          newStorageIds[i] = storageId;
          newUrls[i] = url || imageUrl;
        } catch (err) {
          console.error(`  Error migrating portfolio image ${i}: ${err.message}`);
        }
      }

      try {
        await convex.mutation(api.instructors.updateInstructorPortfolioStorageIdsForProfile, {
          slug: profile.slug,
          storageIds: newStorageIds,
          urls: newUrls,
        });
        console.log(`  Updated portfolio storage IDs`);
      } catch (err) {
        console.error(`  Error updating portfolio: ${err.message}`);
      }
    }
  }

  console.log("\nInstructorProfiles migration complete!");
}

async function migrateMenteeResults(convex) {
  console.log("\n=== Migrating mentee results ===");

  const results = await convex.query(api.instructors.listMenteeResultsInternal, {});

  console.log(`Found ${results.length} mentee results`);

  for (const result of results) {
    console.log(`\nProcessing mentee result: ${result._id}`);

    if (result.imageUrl && !result.imageStorageId) {
      const localPath = getLocalFilePath(result.imageUrl);
      if (fs.existsSync(localPath)) {
        try {
          console.log(`  Migrating image from: ${localPath}`);
          const arrayBuffer = fs.readFileSync(localPath);
          const { storageId } = await uploadToConvex(convex, arrayBuffer);
          const url = await getStorageUrl(convex, storageId);

          await convex.mutation(api.instructors.updateMenteeResultStorageId, {
            menteeResultId: result._id,
            storageId,
            url: url || result.imageUrl,
          });

          console.log(`  Mentee result image migrated: storageId=${storageId}`);
        } catch (err) {
          console.error(`  Error migrating mentee result image: ${err.message}`);
        }
      } else {
        console.log(`  Image NOT FOUND at: ${localPath}`);
      }
    } else if (result.imageStorageId) {
      console.log(`  Already migrated`);
    } else {
      console.log(`  No image to migrate`);
    }
  }

  console.log("\nMentee results migration complete!");
}

async function main() {
  console.log("===========================================");
  console.log("Instructor Image Migration to Convex Storage");
  console.log("===========================================");
  console.log(`Convex URL: ${convexUrl}`);
  console.log(`Local images base: ${LOCAL_IMAGES_BASE}`);

  const convex = new ConvexHttpClient(convexUrl);

  try {
    await migrateInstructors(convex);
    await migrateInstructorProfiles(convex);
    await migrateMenteeResults(convex);

    console.log("\n===========================================");
    console.log("=== Migration Summary ===");
    console.log("===========================================");

    const status = await convex.query(api.instructors.getMigrationStatus, {});

    console.log(`Instructors needing profile migration: ${status.instructorsNeedingProfileMigration}`);
    console.log(`Instructors needing portfolio migration: ${status.instructorsNeedingPortfolioMigration}`);
    console.log(`Profiles needing profile migration: ${status.profilesNeedingProfileMigration}`);
    console.log(`Profiles needing portfolio migration: ${status.profilesNeedingPortfolioMigration}`);
    console.log(`Mentee results needing migration: ${status.menteeResultsNeedingMigration}`);
    console.log(`Instructors with storageId: ${status.instructorsWithStorageId}`);
    console.log(`Profiles with storageId: ${status.profilesWithStorageId}`);

    const totalRemaining =
      status.instructorsNeedingProfileMigration +
      status.instructorsNeedingPortfolioMigration +
      status.profilesNeedingProfileMigration +
      status.profilesNeedingPortfolioMigration +
      status.menteeResultsNeedingMigration;

    if (totalRemaining === 0) {
      console.log("\n✓ All images have been migrated!");
    } else {
      console.log(`\n✗ ${totalRemaining} images still need migration`);
    }

    console.log("\nMigration complete!");
  } catch (err) {
    console.error("\nMigration failed:", err);
    process.exit(1);
  }
}

main();