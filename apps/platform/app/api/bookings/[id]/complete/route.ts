import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Only instructors can mark completed via this endpoint
    await requireRoleForApi("instructor");
    const { id } = await params;
    const idSchema = z.string().min(1);
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
    }

    const convex = getConvexClient();
    await convex.mutation(api.bookings.complete, { id: id as Id<"bookings"> });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Booking complete error:", error);
    return NextResponse.json({ error: "Failed to mark booking completed" }, { status: 500 });
  }
}
