// List instructors and whether they have an active one-on-one product with a Stripe price
// Usage:
//   NEXT_PUBLIC_CONVEX_URL="https://fine-bulldog-260.convex.cloud" node scripts/list-products-by-instructor.mjs

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
if (!CONVEX_URL) {
  console.error("ERROR: Set NEXT_PUBLIC_CONVEX_URL to your Convex deployment URL.");
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
  let list = await convex.query(api.instructors.getPublicInstructors, {}).catch(() => []);
  list = Array.isArray(list) ? list : [];

  console.log(`[${ts()}] Found ${list.length} instructors`);

  for (const inst of list) {
    try {
      const products = await convex.query(api.products.getProductsByInstructorId, {
        instructorId: inst._id,
      });
      const oneOnOne = (products || []).filter((p) => p.active && p.mentorshipType === "one-on-one");
      const withStripe = oneOnOne.filter((p) => Boolean(p.stripePriceId));
      const status = withStripe.length > 0 ? "READY" : (oneOnOne.length > 0 ? "MISSING_STRIPE_PRICE" : "NO_1_ON_1_PRODUCT");
      console.log(
        `- ${inst.slug || inst._id}: ${status}` +
          (oneOnOne[0] ? ` (title: ${oneOnOne[0].title || "(untitled)"})` : "")
      );
    } catch (e) {
      console.log(`- ${inst.slug || inst._id}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
