import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

/**
 * GET /api/products
 * 
 * Get all active products for checkout
 * Public endpoint - no auth required since products need to be displayed to customers
 */
export async function GET(req: NextRequest) {
  try {
    const convex = getConvexClient();
    const products = await convex.query(api.products.getPublicActiveProducts, {});

    const publicProducts = products.map((product) => ({
      id: product._id,
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