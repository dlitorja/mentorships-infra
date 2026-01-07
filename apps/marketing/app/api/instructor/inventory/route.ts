import { NextRequest, NextResponse } from "next/server";
import { getInstructorInventory } from "@/lib/supabase-inventory";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    const inventory = await getInstructorInventory(slug);

    if (!inventory) {
      return NextResponse.json({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    }

    return NextResponse.json(inventory);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
