import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email";
<<<<<<< HEAD
import { buildBookingConfirmationEmail, buildInstructorNotificationEmail } from "@mentorships/emails/booking";
=======
import { buildBookingConfirmationEmail, buildInstructorNotificationEmail } from "../../../../../../packages/emails/src/booking";
>>>>>>> origin/main

const schema = z.object({
  bookingId: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireAuth();
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

    // AuthZ: only the creating student, owning instructor, or admin may send notifications
    let isAdmin = false;
    try {
      const user = await convex.query(api.users.getUserByUserId as any, { userId });
      isAdmin = (user as any)?.role === "admin";
    } catch {}
    if (!isAdmin && !(booking.createdByUserId === userId || instructor.userId === userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Student email
    if (booking.studentEmail) {
      const built = buildBookingConfirmationEmail(new Date(booking.startUtc), booking.studentName, instructor.name || "Instructor", booking.timezone);
      await sendEmail({ to: booking.studentEmail, subject: built.subject, text: built.text, html: built.html, headers: built.headers });
    }

    // Instructor email
    if (instructor.email && booking.studentEmail) {
      const built = buildInstructorNotificationEmail(new Date(booking.startUtc), instructor.name || "Instructor", booking.studentName, booking.studentEmail, instructor.timeZone || null);
      await sendEmail({ to: instructor.email, subject: built.subject, text: built.text, html: built.html, headers: built.headers });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Notify booking error:", error);
    return NextResponse.json({ error: "Failed to send notifications" }, { status: 500 });
  }
}
