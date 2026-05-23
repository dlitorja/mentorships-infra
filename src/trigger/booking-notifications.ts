import { task } from "@trigger.dev/sdk";
<<<<<<< HEAD
import { sendEmail } from "@mentorships/emails/send";
import { buildBookingConfirmationEmail, buildInstructorNotificationEmail } from "@mentorships/emails/booking";
=======
import { sendEmail } from "../../packages/emails/src/send";
import { buildBookingConfirmationEmail, buildInstructorNotificationEmail } from "../../packages/emails/src/booking";
>>>>>>> origin/main

type Payload = {
  studentEmail: string;
  studentName: string;
  instructorEmail: string | null;
  instructorName: string | null;
  scheduledAtUtc: number; // ms since epoch
  studentTimeZone: string | null;
  instructorTimeZone: string | null;
};

export const bookingNotifications = task({
  id: "booking-notifications",
  // Robust retries as this is non-critical but important
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },
  run: async (payload: Payload) => {
    // Student email
    if (payload.studentEmail) {
      const built = buildBookingConfirmationEmail(
        new Date(payload.scheduledAtUtc),
        payload.studentName,
        payload.instructorName || "Instructor",
        payload.studentTimeZone,
      );
      await sendEmail({ to: payload.studentEmail, subject: built.subject, text: built.text, html: built.html, headers: built.headers });
    }

    // Instructor email
    if (payload.instructorEmail) {
      const built = buildInstructorNotificationEmail(
        new Date(payload.scheduledAtUtc),
        payload.instructorName || "Instructor",
        payload.studentName,
        payload.studentEmail,
        payload.instructorTimeZone,
      );
      await sendEmail({ to: payload.instructorEmail, subject: built.subject, text: built.text, html: built.html, headers: built.headers });
    }

    return { ok: true } as const;
  },
});
