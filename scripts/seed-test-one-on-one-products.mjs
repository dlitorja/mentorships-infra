// Seed test 1-on-1 products for all active instructors missing one
// Uses a template instructor's existing 1-on-1 product to copy Stripe price and config
// Usage:
//   NEXT_PUBLIC_CONVEX_URL="https://fine-bulldog-260.convex.cloud" node scripts/seed-test-one-on-one-products.mjs

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
if (!CONVEX_URL) {
  console.error("ERROR: Set NEXT_PUBLIC_CONVEX_URL to your Convex deployment URL.");
  process.exit(1);
}

const TEMPLATE_INSTRUCTOR_SLUG = process.env.TEMPLATE_INSTRUCTOR_SLUG || "instructor-may22";

const convex = new ConvexHttpClient(CONVEX_URL);

function fmt(n) { return n.toString().padStart(2, "0"); }
function ts() { const d = new Date(); return `${fmt(d.getHours())}:${fmt(d.getMinutes())}:${fmt(d.getSeconds())}`; }

async function getTemplateProduct() {
  const inst = await convex.query(api.instructors.getInstructorBySlug, { slug: TEMPLATE_INSTRUCTOR_SLUG });
  if (!inst) throw new Error(`Template instructor not found: ${TEMPLATE_INSTRUCTOR_SLUG}`);
  const templateInstructorId = inst.instructorId || inst._id;
  if (!templateInstructorId) throw new Error(`Template instructor missing id: ${TEMPLATE_INSTRUCTOR_SLUG}`);
  const products = await convex.query(api.products.getProductsByInstructorId, { instructorId: templateInstructorId });
  const ready = (products || []).find((p) => p.active && p.mentorshipType === "one-on-one" && p.stripePriceId);
  if (!ready) throw new Error(`No ready template product found for ${TEMPLATE_INSTRUCTOR_SLUG}`);
  return ready;
}

async function hasReadyProduct(instructorId) {
  const products = await convex.query(api.products.getProductsByInstructorId, { instructorId }).catch(() => []);
  return (products || []).some((p) => p.active && p.mentorshipType === "one-on-one" && p.stripePriceId);
}

async function main() {
  console.log(`[${ts()}] Seeding test 1-on-1 products using template ${TEMPLATE_INSTRUCTOR_SLUG}`);
  const template = await getTemplateProduct();
  console.log(`[${ts()}] Template stripePriceId=${template.stripePriceId}, price=${template.price}`);

  // Optional unique Stripe price creation per instructor if Stripe secret is provided
  let stripe = null;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(stripeKey);
    console.log(`[${ts()}] Stripe key detected; will create unique Prices per instructor`);
  } else {
    console.log(`[${ts()}] No STRIPE_SECRET_KEY set; will reuse template stripePriceId for all seeded products`);
  }
  const instructors = (await convex.query(api.instructors.getPublicInstructors, {})) || [];
  const active = instructors.filter((i) => i && i.isActive !== false);
  let created = 0;
  const skipped = [];

  for (const inst of active) {
    if (!inst._id) continue;
    const ready = await hasReadyProduct(inst._id);
    if (ready) {
      skipped.push(inst.slug || inst._id);
      continue;
    }

    try {
      let stripePriceId = template.stripePriceId;
      let stripeProductId = template.stripeProductId || undefined;
      if (stripe) {
        const unitAmount = Math.round(parseFloat(String(template.price)) * 100);
        const currency = (template.currency || 'usd').toLowerCase();
        const price = await stripe.prices.create({
          unit_amount: unitAmount,
          currency,
          product_data: {
            name: `Test 1-on-1 Pack (${inst.slug || inst.name || inst._id})`,
          },
        });
        stripePriceId = price.id;
        stripeProductId = typeof price.product === 'string' ? price.product : undefined;
        console.log(`[${ts()}] Created Stripe price ${stripePriceId} for ${inst.slug || inst._id}`);
      }
      await convex.mutation(api.products.createProduct, {
        instructorId: inst._id,
        title: `Test 1-on-1 Pack (${inst.slug || inst.name || inst._id})`,
        description: `Auto-seeded test 1-on-1 pack for ${inst.name || inst.slug || inst._id}`,
        price: template.price,
        currency: template.currency || "usd",
        sessionsPerPack: template.sessionsPerPack || 4,
        validityDays: template.validityDays || 30,
        stripePriceId,
        stripeProductId,
        mentorshipType: "one-on-one",
        active: true,
      });
      console.log(`[${ts()}] Created test product for ${inst.slug || inst._id}`);
      created++;
    } catch (e) {
      console.error(`[${ts()}] ERROR creating product for ${inst.slug || inst._id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`\n=== Seed Summary ===`);
  console.log(`Created products: ${created}`);
  if (skipped.length) {
    console.log(`Already had ready product (${skipped.length}):`);
    for (const id of skipped) console.log(`- ${id}`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
