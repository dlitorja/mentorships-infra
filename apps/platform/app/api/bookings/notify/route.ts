import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email";
import { buildBookingConfirmationEmail, buildInstructorNotificationEmail } from "../../../../../packages/emails/src/booking";

const schema = z.object({
  bookingId: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth();
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }
    const convex = getConvexClient();
    const booking = await convex.query(api.bookings.getBookingById, { id: parsed.data.bookingId as Id<"bookings"> });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const instructor = await convex.query(api.instructors.getInstructorById, { id: booking.instructorId });
    if (!instructor) return NextResponse.json({ error: "Instructor not found" }, { status: 404 });

    // Student email
    if (booking.studentEmail) {
      const built = buildBookingConfirmationEmail(new Date(booking.startUtc), booking.studentName, instructor.name || "Instructor", booking.timezone);
      await sendEmail({ to: booking.studentEmail, subject: built.subject, text: built.text, html: built.html, headers: built.headers });
    }

    // Instructor email
    if (instructor.email) {
      const built = buildInstructorNotificationEmail(new Date(booking.startUtc), instructor.name || "Instructor", booking.studentName, booking.studentEmail, instructor.timeZone || null);
      await sendEmail({ to: instructor.email, subject: built.subject, text: built.text, html: built.html, headers: built.headers });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Notify booking error:", error);
    return NextResponse.json({ error: "Failed to send notifications" }, { status: 500 });
  }
}
