import { task } from "@trigger.dev/sdk";
import { sendEmail } from "../../packages/emails/src/send";
import { buildSeriesSummaryEmails } from "../../packages/emails/src/booking";

type Payload = {
  studentEmail: string | null;
  instructorEmail: string | null;
  studentName: string;
  instructorName: string | null;
  timesUtc: number[]; // includes initial time and any created series times
  studentTimeZone: string | null;
  instructorTimeZone: string | null;
  skippedCount: number;
};

export const bookingSeriesNotifications = task({
  id: "booking-series-notifications",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
    randomize: true,
  },
  run: async (payload: Payload) => {
    const summary = buildSeriesSummaryEmails({
      studentName: payload.studentName,
      studentEmail: payload.studentEmail || "",
      instructorName: payload.instructorName || null,
      instructorEmail: payload.instructorEmail || null,
      timesUtc: payload.timesUtc,
      studentTimeZone: payload.studentTimeZone || null,
      instructorTimeZone: payload.instructorTimeZone || null,
      skippedCount: payload.skippedCount,
    });

    if (payload.studentEmail) {
      await sendEmail({
        to: payload.studentEmail,
        subject: summary.student.subject,
        text: summary.student.text,
        headers: summary.student.headers,
      });
    }

    if (payload.instructorEmail) {
      await sendEmail({
        to: payload.instructorEmail,
        subject: summary.instructor.subject,
        text: summary.instructor.text,
        headers: summary.instructor.headers,
      });
    }

    return { ok: true as const };
  },
});
