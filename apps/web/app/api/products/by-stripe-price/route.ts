import { NextRequest, NextResponse } from "next/server";
import { db, mentorshipProducts, eq } from "@mentorships/db";

/**
 * Get product by Stripe Price ID
 * This helps when you only have the Stripe price ID from the dashboard
 */
export async function GET(req: NextRequest) {
  try {
    const stripePriceId = req.nextUrl.searchParams.get("priceId");
    
    if (!stripePriceId) {
      return NextResponse.json(
        { error: "priceId query parameter is required" },
        { status: 400 }
      );
    }
    
    const [product] = await db
      .select()
      .from(mentorshipProducts)
      .where(eq(mentorshipProducts.stripePriceId, stripePriceId))
      .limit(1);
    
    if (!product) {
      return NextResponse.json(
        { error: "Product not found with this Stripe price ID" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: product.id,
      title: product.title,
      price: product.price,
      sessionsPerPack: product.sessionsPerPack,
      validityDays: product.validityDays,
      stripePriceId: product.stripePriceId,
    });
  } catch (error) {
    console.error("Error fetching product by Stripe price ID:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

