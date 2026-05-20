import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

const bodySchema = z.object({
  eventCalendarId: z.string().min(1),
  availabilityCalendarIds: z.array(z.string().min(1)).min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();
    const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const { eventCalendarId, availabilityCalendarIds } = parsed.data;
    await convex.mutation(api.instructors.updateInstructor, {
      id: instructor._id,
      googleCalendarId: eventCalendarId,
      googleAvailabilityCalendarIds: availabilityCalendarIds,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[platform] Save calendar selection error:", error);
    return NextResponse.json({ error: "Failed to save calendar selection" }, { status: 500 });
  }
}
