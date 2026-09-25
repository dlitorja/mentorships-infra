import { NextRequest, NextResponse } from "next/server";
import { convexServerCall } from "@/lib/convex-server-call";

interface PublicInventoryResponse {
  success: boolean;
  one_on_one_inventory: number;
  group_inventory: number;
}

interface PublicInventoryErrorResponse {
  success: false;
  error: string;
}

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

    const inventory = await convexServerCall<
      PublicInventoryResponse | PublicInventoryErrorResponse
    >("/inventory/get-public-by-slug", { slug });

    if (!inventory.success) {
      // Distinguish "instructor not found" (404) from upstream errors
      // (5xx). The page renders zeros for unknown slugs so visitors
      // always see a graceful response.
      return NextResponse.json(
        {
          one_on_one_inventory: 0,
          group_inventory: 0,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      one_on_one_inventory: inventory.one_on_one_inventory,
      group_inventory: inventory.group_inventory,
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
