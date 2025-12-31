import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  db,
  mentorshipProducts,
  mentors,
  requireAuth,
  eq,
} from "@mentorships/db";
import { stripe } from "@/lib/stripe";
import { requireRole } from "@/lib/auth-helpers";

/**
 * Create a database product from a Stripe Product ID or Price ID
 * This is a helper endpoint for testing/setup
 * 
 * Accepts either:
 * - productId: Stripe Product ID (e.g., prod_...) - will use the default price
 * - priceId: Stripe Price ID (e.g., price_...) - preferred
 * 
 * Requires admin role to prevent unauthorized product creation
 */
export async function POST(req: NextRequest) {
  try {
    // Require admin role for product creation
    await requireRole("admin");
    
    const { productId, priceId, mentorId } = await req.json();
    
    if (!productId && !priceId) {
      return NextResponse.json(
        { error: "Either productId or priceId is required" },
        { status: 400 }
      );
    }

    let price: Stripe.Price;
    let product: Stripe.Product;

    if (priceId) {
      // If price ID provided, use it directly
      price = await stripe.prices.retrieve(priceId);
      product = await stripe.products.retrieve(price.product as string);
    } else if (productId) {
      // If product ID provided, get the default price
      product = await stripe.products.retrieve(productId);
      const prices = await stripe.prices.list({
        product: productId,
        active: true,
        limit: 1,
      });
      
      if (prices.data.length === 0) {
        return NextResponse.json(
          { error: "No active prices found for this product" },
          { status: 400 }
        );
      }
      
      price = prices.data[0];
    } else {
      return NextResponse.json(
        { error: "Either productId or priceId is required" },
        { status: 400 }
      );
    }

    // Get or use provided mentor ID
    let finalMentorId = mentorId;
    if (!finalMentorId) {
      // Try to find a mentor (for testing, use first available)
      const [firstMentor] = await db
        .select()
        .from(mentors)
        .limit(1);
      
      if (!firstMentor) {
        return NextResponse.json(
          { error: "No mentors found. Please create a mentor first or provide mentorId" },
          { status: 400 }
        );
      }
      finalMentorId = firstMentor.id;
    }

    // Check if product already exists with this price ID
    const [existing] = await db
      .select()
      .from(mentorshipProducts)
      .where(eq(mentorshipProducts.stripePriceId, price.id))
      .limit(1);

    if (existing) {
      return NextResponse.json({
        message: "Product already exists",
        product: {
          id: existing.id,
          title: existing.title,
          price: existing.price,
          stripePriceId: existing.stripePriceId,
        },
      });
    }

    // Extract sessions from metadata or default to 4
    const sessions = product.metadata?.sessions 
      ? parseInt(product.metadata.sessions, 10) 
      : 4;

    // Validate price has unit_amount (required for fixed pricing)
    if (!price.unit_amount) {
      return NextResponse.json(
        { error: "This price has no unit amount (custom pricing or free products not supported)" },
        { status: 400 }
      );
    }

    // Create database product
    const [newProduct] = await db
      .insert(mentorshipProducts)
      .values({
        mentorId: finalMentorId,
        title: product.name || "Mentorship Session Pack",
        price: (price.unit_amount! / 100).toString(), // Convert cents to dollars
        sessionsPerPack: sessions,
        validityDays: 30, // Default
        stripePriceId: price.id,
        active: true,
      })
      .returning();

    return NextResponse.json({
      message: "Product created successfully",
      product: {
        id: newProduct.id,
        title: newProduct.title,
        price: newProduct.price,
        sessionsPerPack: newProduct.sessionsPerPack,
        stripePriceId: newProduct.stripePriceId,
      },
    });
  } catch (error) {
    console.error("Error creating product from Stripe:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create product" },
      { status: 500 }
    );
  }
}

