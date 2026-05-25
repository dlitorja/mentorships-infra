// Assign existing active Stripe products to active instructors by matching names/slugs
// Then ensure those products are marked as one-on-one and active
// Usage:
//   NEXT_PUBLIC_CONVEX_URL="https://fine-bulldog-260.convex.cloud" node scripts/assign-products-to-instructors.mjs

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

function normalize(s) {
  return (s || "").toString().toLowerCase();
}

function slugify(s) {
  return normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main() {
  console.log(`[${ts()}] Fetching public instructors & products from`, CONVEX_URL);
  const instructors = (await convex.query(api.instructors.getPublicInstructors, {})) || [];
  const products = (await convex.query(api.products.getPublicActiveProducts, {})) || [];

  const activeInstructors = instructors.filter((i) => i && i.isActive !== false);
  console.log(`[${ts()}] Active instructors: ${activeInstructors.length}; Active products: ${products.length}`);
  const DRY_RUN = process.env.DRY_RUN !== '0' && process.env.CONFIRM !== '1';
  const ALLOW_REASSIGN = process.env.ALLOW_REASSIGN === '1';
  let assigned = 0;
  const missingMatches = [];

  for (const inst of activeInstructors) {
    const instName = normalize(inst.name || "");
    const instSlug = (inst.slug ? inst.slug : slugify(inst.name || String(inst._id)));

    // Skip if already has a 1-on-1 product linked
    const existing = await convex.query(api.products.getProductsByInstructorId, { instructorId: inst._id }).catch(() => []);
    const hasReady = (existing || []).some((p) => p.active && p.mentorshipType === "one-on-one" && p.stripePriceId);
    if (hasReady) {
      continue;
    }

    // Find a candidate product: active, has stripePriceId, and title or description includes instructor name or slug
    const candidates = (products || []).filter((p) => {
      if (!p || !p.active) return false;
      if (!p.stripePriceId) return false;
      const title = normalize(p.title || "");
      const desc = normalize(p.description || "");
      const hasName = instName && (title.includes(instName) || desc.includes(instName));
      const hasSlug = instSlug && (title.includes(instSlug) || desc.includes(instSlug));
      return hasName || hasSlug;
    });

    // Prefer one labeled one-on-one, else any
    let chosen = candidates.find((p) => p.mentorshipType === "one-on-one") || candidates[0];

    if (!chosen) {
      missingMatches.push(inst.slug || inst.name || inst._id);
      continue;
    }

    // Safety: don't reassign if product already linked to another instructor unless explicitly allowed
    if (chosen.instructorId && String(chosen.instructorId) !== String(inst._id) && !ALLOW_REASSIGN) {
      console.log(`[${ts()}] Skip reassigning product ${chosen._id} already linked to ${chosen.instructorId} → ${inst._id}`);
      continue;
    }

    try {
      if (DRY_RUN) {
        console.log(`[${ts()}] DRY-RUN would link product ${chosen._id} → ${inst.slug || inst._id}`);
      } else {
        await convex.mutation(api.products.updateProduct, {
          id: chosen._id,
          instructorId: inst._id,
          mentorshipType: "one-on-one",
          active: true,
        });
        console.log(`[${ts()}] Linked product ${chosen._id} → ${inst.slug || inst._id}`);
        assigned++;
      }
    } catch (e) {
      console.error(`[${ts()}] ERROR linking product ${chosen._id} to ${inst.slug || inst._id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`\n=== Assignment Summary ===`);
  console.log(`Assigned products: ${assigned}`);
  if (missingMatches.length) {
    console.log(`No matching product found for (${missingMatches.length}):`);
    for (const id of missingMatches) console.log(`- ${id}`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
