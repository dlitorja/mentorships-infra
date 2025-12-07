/**
 * Script to create a mentorship product in the database
 * 
 * Usage:
 *   pnpm tsx scripts/create-product.ts
 * 
 * Or run interactively in a Node.js environment
 */

import { createProduct } from "../packages/db/src/lib/queries/products";
import { db, mentors, users } from "../packages/db/src";
import { eq } from "drizzle-orm";

async function main() {
  // Example: Create product for Ash Kirk
  // You'll need to:
  // 1. Find the mentor ID for Ash Kirk (or create the mentor first)
  // 2. Adjust the values below
  
  try {
    // First, let's find or you'll need to provide the mentor ID
    // Option 1: Find mentor by user email/name
    // const [mentor] = await db.select().from(mentors).where(...).limit(1);
    
    // Option 2: Use mentor ID directly if you know it
    const mentorId = process.env.MENTOR_ID || ""; // Set this or find it
    
    if (!mentorId) {
      console.error("❌ MENTOR_ID environment variable required");
      console.log("\nTo find mentor ID:");
      console.log("1. Check your mentors table in Supabase");
      console.log("2. Or query: SELECT id FROM mentors WHERE user_id = 'clerk_user_id'");
      process.exit(1);
    }

    const product = await createProduct(
      mentorId,
      "Ash Kirk 1-on-1 Mentorship (4 sessions)",
      "375.00",
      "price_1SbNPUA4l1a5LDm782TSgPx6", // Your Stripe Price ID
      4, // sessions per pack
      30, // validity days (default)
      true // active
    );

    console.log("✅ Product created successfully!");
    console.log("Product ID:", product.id);
    console.log("Title:", product.title);
    console.log("Price:", product.price);
    console.log("Stripe Price ID:", product.stripePriceId);
    console.log("\nYou can now use this product ID in your checkout flow!");
  } catch (error) {
    console.error("❌ Error creating product:", error);
    process.exit(1);
  }
}

// Uncomment to run:
// main();


