import { NextRequest, NextResponse } from "next/server";
import { getAllActiveProducts } from "@mentorships/db";

/**
 * GET /api/products
 * 
 * Get all active products for checkout
 * Public endpoint - no auth required since products need to be displayed to customers
 */
export async function GET(req: NextRequest) {
  try {
    const products = await getAllActiveProducts();

    // Return products with only safe/public fields
    const publicProducts = products.map((product) => ({
      id: product.id,
      title: product.title,
      price: product.price,
      sessionsPerPack: product.sessionsPerPack,
      validityDays: product.validityDays,
      stripePriceId: product.stripePriceId,
      paypalProductId: product.paypalProductId,
      mentorId: product.mentorId,
    }));

    return NextResponse.json({ items: publicProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}