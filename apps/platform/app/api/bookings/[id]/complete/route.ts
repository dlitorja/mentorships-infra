import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Require an authenticated user; role checks are enforced server-side in Convex
    await requireAuth();
    const { id } = await params;
    const idSchema = z.string().min(1);
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const schema = z.object({ notes: z.string().max(500).optional() });
    const parsedBody = schema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Invalid request body", details: parsedBody.error.issues }, { status: 400 });
    }
    const notes = parsedBody.data.notes;
    const convex = getConvexClient();
    await convex.mutation(api.bookings.complete, { id: id as Id<"bookings">, notes });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Booking complete error:", error);
    return NextResponse.json({ error: "Failed to mark booking completed" }, { status: 500 });
  }
}
