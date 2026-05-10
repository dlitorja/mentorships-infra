/**
 * Script to create a demo product with a valid Stripe price ID
 *
 * Usage:
 *   npx tsx scripts/create-demo-product.ts
 *
 * Prerequisites:
 *   1. Create a product and price in Stripe Dashboard (test mode)
 *   2. Copy the Price ID (looks like price_xxx)
 *   3. Set STRIPE_PRICE_ID environment variable or replace in script
 */

import { ConvexHttpClient } from "convex/browser";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
const convex = new ConvexHttpClient(convexUrl);

// Replace this with your actual Stripe Price ID from test mode
// Create one at: https://dashboard.stripe.com/test/products
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "price_YOUR_STRIPE_PRICE_ID";

async function main() {
  // First, find an instructor to link the product to
  const instructors = await convex.query("instructors:listInstructors", {});
  console.log("Found instructors:", instructors.length);

  if (instructors.length === 0) {
    console.error("No instructors found. Please create an instructor first.");
    process.exit(1);
  }

  const instructor = instructors[0];
  console.log("Using instructor:", instructor.name, instructor._id);

  // Check if product already exists
  const existingProducts = await convex.query("products:getActiveProducts", {});
  const demoProduct = existingProducts.find(p => p.title === "Demo 4-Session Pack");

  if (demoProduct) {
    console.log("Demo product already exists:", demoProduct._id);
    console.log("stripePriceId:", demoProduct.stripePriceId);

    if (!demoProduct.stripePriceId && STRIPE_PRICE_ID !== "price_YOUR_STRIPE_PRICE_ID") {
      console.log("\nUpdating demo product with Stripe price ID...");
      const updated = await convex.mutation("products:updateProduct", {
        id: demoProduct._id,
        stripePriceId: STRIPE_PRICE_ID,
      });
      console.log("Updated product:", updated?._id);
    }
    return;
  }

  // Create a new demo product
  console.log("\nCreating demo product with Stripe price ID:", STRIPE_PRICE_ID);

  const product = await convex.mutation("products:createProduct", {
    mentorId: instructor._id,
    title: "Demo 4-Session Pack",
    description: "Demo mentorship pack for testing payment flow",
    price: "199.00",
    currency: "usd",
    sessionsPerPack: 4,
    validityDays: 60,
    stripePriceId: STRIPE_PRICE_ID,
    mentorshipType: "oneOnOne",
    active: true,
  });

  console.log("Created product:", product?._id);
  console.log("\nYou can now test checkout at /checkout?instructor=" + instructor.slug + "&type=one-on-one");
}

main().catch(console.error);