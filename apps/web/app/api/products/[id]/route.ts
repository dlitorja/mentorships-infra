import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { requireAuth, isUnauthorizedError } from "@/lib/auth";

/**
 * GET /api/products/[id]
 * 
 * Get product details by ID
 * Requires authentication to prevent exposing Stripe price IDs to unauthenticated users
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    
    const { id } = await params;
    const convex = getConvexClient();
    
    const product = await convex.query(api.products.getProductById, {
      id: id as Id<"products">,
    });
    
    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: product._id,
      title: product.title,
      price: product.price,
      sessionsPerPack: product.sessionsPerPack,
      validityDays: product.validityDays,
      stripePriceId: product.stripePriceId,
      mentorId: product.mentorId,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    console.error("Error fetching product:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}