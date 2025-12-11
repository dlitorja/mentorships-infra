import { NextRequest, NextResponse } from "next/server";
import { getProductById } from "@mentorships/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const product = await getProductById(id);
    
    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
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
      mentor: {
        id: product.mentor.id,
        userId: product.mentor.userId,
      },
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

