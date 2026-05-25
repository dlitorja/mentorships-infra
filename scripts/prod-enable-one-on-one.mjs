// One-off script: Enable 1-on-1 purchase only across all instructors in Convex prod
// - Deactivate all group products
// - Ensure 1-on-1 products are active
// - Ensure instructor.oneOnOneInventory > 0
// Usage:
//   NEXT_PUBLIC_CONVEX_URL="https://<your>.convex.cloud" node scripts/prod-enable-one-on-one.mjs

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
if (!CONVEX_URL) {
  console.error("ERROR: Set NEXT_PUBLIC_CONVEX_URL to your prod Convex deployment URL.");
  process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);

function fmt(n) {
  return n.toString().padStart(2, "0");
}

function ts() {
  const d = new Date();
  return `${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`;
}

async function main() {
  console.log(`[${ts()}] Fetching instructors from`, CONVEX_URL);
  let list = await convex.query(api.instructors.getInstructorsForAdmin, {}).catch(() => []);
  if (!Array.isArray(list) || list.length === 0) {
    // Fallback to public instructors listing (no auth required)
    list = await convex.query(api.instructors.getPublicInstructors, {}).catch(() => []);
  }
  list = Array.isArray(list) ? list : [];
  const slugs = list.map((i) => i.slug).filter(Boolean);
  console.log(`[${ts()}] Found ${list.length} instructors`);
  console.log(slugs.join(", "));

  let groupDeactivated = 0;
  let oneOnOneActivated = 0;
  let inventoryRaised = 0;
  const missingStripe = [];

  for (const inst of list) {
    if (!inst?._id) continue;
    const instructorId = inst._id;
    const slug = inst.slug || instructorId;
    const products = await convex.query(api.products.getProductsByInstructorId, { instructorId });

    // Deactivate all group products
    for (const p of products) {
      if (p?.mentorshipType === "group" && p?.active) {
        await convex.mutation(api.products.deactivateProduct, { id: p._id });
        groupDeactivated++;
        console.log(`[${ts()}] Deactivated group product ${p._id} for ${slug}`);
      }
    }

    // Ensure one-on-one product active
    const oneOnOne = products.find((p) => p?.mentorshipType === "one-on-one");
    if (oneOnOne) {
      if (!oneOnOne.active) {
        await convex.mutation(api.products.activateProduct, { id: oneOnOne._id });
        oneOnOneActivated++;
        console.log(`[${ts()}] Activated 1-on-1 product ${oneOnOne._id} for ${slug}`);
      }
      if (!oneOnOne.stripePriceId) {
        missingStripe.push({ slug, productId: oneOnOne._id });
      }
    } else {
      console.warn(`[${ts()}] WARNING: No 1-on-1 product for ${slug}`);
    }

    // Ensure inventory > 0 for 1-on-1
    const inv = (inst.oneOnOneInventory ?? 0);
    if (inv <= 0) {
      await convex.mutation(api.instructors.updateInstructor, { id: instructorId, oneOnOneInventory: 3 });
      inventoryRaised++;
      console.log(`[${ts()}] Set oneOnOneInventory=3 for ${slug}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Group products deactivated: ${groupDeactivated}`);
  console.log(`1-on-1 products activated: ${oneOnOneActivated}`);
  console.log(`Instructors with inventory raised: ${inventoryRaised}`);
  if (missingStripe.length) {
    console.log(`\n1-on-1 products missing stripePriceId (${missingStripe.length}):`);
    for (const r of missingStripe) {
      console.log(`- ${r.slug}: product ${r.productId}`);
    }
  } else {
    console.log("All 1-on-1 products have stripePriceId");
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
