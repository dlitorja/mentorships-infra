import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { auth } from "@clerk/nextjs/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const clerkAuth = await auth();
    const { userId: clerkUserId } = clerkAuth;
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const convex = getConvexClient();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const stats = await convex.query(api.admin.getStats, {});

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);

    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}