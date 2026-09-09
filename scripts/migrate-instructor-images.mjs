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
      } catch (err) {
        console.error(`  Error updating portfolio storage IDs: ${err.message}`);
      }
    }
  }

  console.log("\nInstructor migration complete!");
}

async function migrateStudentResults(convex) {
  console.log("\n=== Migrating student results ===");

  const results = await convex.query(api.instructors.listStudentResultsInternal, {});

  console.log(`Found ${results.length} student results`);

  for (const result of results) {
    console.log(`\nProcessing student result: ${result._id}`);

    if (result.imageUrl && !result.imageStorageId) {
      const localPath = getLocalFilePath(result.imageUrl);
      if (fs.existsSync(localPath)) {
        try {
          console.log(`  Migrating image from: ${localPath}`);
          const arrayBuffer = fs.readFileSync(localPath);
          const { storageId } = await uploadToConvex(convex, arrayBuffer);
          const url = await getStorageUrl(convex, storageId);

          await convex.mutation(api.instructors.updateStudentResultStorageId, {
            studentResultId: result._id,
            storageId,
            url: url || result.imageUrl,
          });

          console.log(`  Student result image migrated: storageId=${storageId}`);
        } catch (err) {
          console.error(`  Error migrating student result image: ${err.message}`);
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

  console.log("\nStudent results migration complete!");
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
    await migrateStudentResults(convex);

    console.log("\n===========================================");
    console.log("=== Migration Summary ===");
    console.log("===========================================");

    const status = await convex.query(api.instructors.getMigrationStatus, {});

    console.log(`Instructors needing profile migration: ${status.instructorsNeedingProfileMigration}`);
    console.log(`Instructors needing portfolio migration: ${status.instructorsNeedingPortfolioMigration}`);
    console.log(`Instructors with storageId: ${status.instructorsWithStorageId}`);
    console.log(`Total instructors: ${status.totalInstructors}`);

    const totalRemaining =
      status.instructorsNeedingProfileMigration +
      status.instructorsNeedingPortfolioMigration;

    if (totalRemaining === 0) {
      console.log("\n✓ All instructor images have been migrated!");
    } else {
      console.log(`\n✗ ${totalRemaining} instructor images still need migration`);
    }

    console.log("\nMigration complete!");
  } catch (err) {
    console.error("\nMigration failed:", err);
    process.exit(1);
  }
}

main();
