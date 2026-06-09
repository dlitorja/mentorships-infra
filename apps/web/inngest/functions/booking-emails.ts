import { inngest } from "../client";
import { getUserById, getInstructorById, getSessionById, getSessionPackById } from "@mentorships/db";
import { clerkClient } from "@clerk/nextjs/server";
import { sendEmail } from "@/lib/email";
import {
  buildBookingConfirmationEmail,
  buildInstructorNotificationEmail,
  buildReminderEmail,
  buildCancellationEmail,
} from "@/lib/emails/booking-email";
import { reportError, reportInfo } from "@/lib/observability";
import type { SessionScheduledEvent } from "../types";

async function getClerkApi() {
  return await clerkClient();
}

async function getClerkUserName(clerkId: string): Promise<string> {
  try {
    const clerk = await getClerkApi();
    const user = await clerk.users.getUser(clerkId);
    return (
      (user.firstName || user.lastName
        ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
        : null) ?? user.username ?? "there"
    );
  } catch {
    return "there";
  }
}

async function getUserEmail(clerkId: string): Promise<string | null> {
  const user = await getUserById(clerkId);
  return user?.email ?? null;
}

/**
 * Handles booking confirmation and notification emails when a session is booked.
 *
 * Triggered by: `session/booking-email`
 *
 * Sends emails based on the `type` field in the event data:
 * - `booking_confirmation_student`: Confirmation email to the student
 * - `booking_notification_instructor`: Notification email to the instructor
 *
 * Requires instructor.userId to be set for instructor notifications.
 * Falls back gracefully if student timeZone is not available.
 *
 * @returns Object with success status, sessionId, and type
 */
export const handleSessionBookingEmails = inngest.createFunction(
  {
    id: "handle-session-booking-emails",
    name: "Handle Session Booking Emails",
    retries: 2,
  },
  { event: "session/booking-email" },
  async ({ event, step }) => {
    const { type, sessionId, sessionPackId, studentId, instructorId, scheduledAt } = event.data;

    const [session, pack, instructor] = await Promise.all([
      step.run("get-session", () => getSessionById(sessionId)),
      step.run("get-pack", () => getSessionPackById(sessionPackId)),
      step.run("get-instructor", () => getInstructorById(instructorId)),
    ]);

    if (!session || !pack || !instructor) {
      throw new Error(`Missing session, pack, or instructor for booking email`);
    }

    const hasInstructorUserId = !!instructor.userId;

    if (type === "booking_notification_instructor" && !hasInstructorUserId) {
      await reportError({
        source: "inngest/booking-emails",
        error: new Error("Cannot send instructor notification: instructor.userId is null"),
        level: "error",
        message: "Cannot send instructor notification: instructor.userId is null. Fix: Set userId on instructor via admin instructor edit page (/admin/instructors/[id]/edit). Instructor ID: " + instructorId,
        context: { sessionId, instructorId, type },
      });
      return { success: false, sessionId, type, reason: "missing_instructor_userId" };
    }

    const [studentName, instructorName, studentEmail, instructorUserEmail] = await Promise.all([
      step.run("get-student-name", () => getClerkUserName(studentId)),
      step.run("get-instructor-name", () =>
        instructor.userId
          ? getClerkUserName(instructor.userId)
          : Promise.resolve(instructor.name || "your instructor")
      ),
      step.run("get-student-email", () => getUserEmail(studentId)),
      step.run("get-instructor-email", () => instructor.userId ? getUserEmail(instructor.userId) : Promise.resolve(null)),
    ]);

    const student = await step.run("get-student-user", () => getUserById(studentId));
    const studentTimeZone = student?.timeZone;

    if (type === "booking_confirmation_student" && studentEmail) {
      const emailContent = buildBookingConfirmationEmail(
        event.data,
        studentName,
        instructorName,
        studentTimeZone
      );

      await step.run("send-student-confirmation", async () => {
        const result = await sendEmail({
          to: studentEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: "Booking confirmation sent to student",
            context: { sessionId, studentId, emailId: result.id },
          });
        } else {
          await reportError({
            source: "inngest/booking-emails",
            error: result,
            level: "error",
            message: "Failed to send booking confirmation to student",
            context: { sessionId, studentId },
          });
        }
      });
    }

    if (type === "booking_notification_instructor" && instructorUserEmail) {
      const instructorUser = await step.run("get-instructor-user", () => getUserById(instructor.userId!));
      const instructorTimeZone = instructorUser?.timeZone;

      const emailContent = buildInstructorNotificationEmail(
        event.data,
        instructorName,
        studentName,
        studentEmail || "Unknown",
        instructorTimeZone
      );

      await step.run("send-instructor-notification", async () => {
        const result = await sendEmail({
          to: instructorUserEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: "Booking notification sent to instructor",
            context: { sessionId, instructorId, emailId: result.id },
          });
        } else {
          await reportError({
            source: "inngest/booking-emails",
            error: result,
            level: "error",
            message: "Failed to send booking notification to instructor",
            context: { sessionId, instructorId },
          });
        }
      });
    }

    return { success: true, sessionId, type };
  }
);

/**
 * Handles session reminder emails sent to students before scheduled sessions.
 *
 * Triggered by: `session/reminder-email`
 *
 * Checks that the session is still in "scheduled" status before sending.
 * Skips silently if session is cancelled or completed.
 * Sends reminder email to the student with session details.
 *
 * @returns Object with success status, sessionId, type, and skipped flag if applicable
 */
export const handleSessionReminderEmails = inngest.createFunction(
  {
    id: "handle-session-reminder-emails",
    name: "Handle Session Reminder Emails",
    retries: 2,
  },
  { event: "session/reminder-email" },
  async ({ event, step }) => {
    const { type, sessionId, sessionPackId, studentId, instructorId, scheduledAt } = event.data;

    const session = await step.run("get-session", () => getSessionById(sessionId));

    if (!session || session.status !== "scheduled") {
      await reportInfo({
        source: "inngest/booking-emails",
        message: `Skipping reminder - session not scheduled`,
        context: { sessionId, status: session?.status },
      });
      return { success: true, skipped: true, reason: "session_not_scheduled" };
    }

    const pack = await step.run("get-pack", () => getSessionPackById(sessionPackId));
    const instructor = await step.run("get-instructor", () => getInstructorById(instructorId));

    if (!pack || !instructor) {
      throw new Error(`Missing pack or instructor for reminder email`);
    }

    const [studentName, instructorName, studentEmail] = await Promise.all([
      step.run("get-student-name", () => getClerkUserName(studentId)),
      step.run("get-instructor-name", () =>
        instructor.userId
          ? getClerkUserName(instructor.userId)
          : Promise.resolve(instructor.name || "your instructor")
      ),
      step.run("get-student-email", () => getUserEmail(studentId)),
    ]);

    const student = await step.run("get-student-user", () => getUserById(studentId));
    const studentTimeZone = student?.timeZone;

    if (studentEmail) {
      const emailContent = buildReminderEmail(
        event.data,
        studentName,
        instructorName,
        studentTimeZone
      );

      await step.run("send-reminder", async () => {
        const result = await sendEmail({
          to: studentEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: `Reminder email (${type}) sent to student`,
            context: { sessionId, studentId, type, emailId: result.id },
          });
        } else {
          await reportError({
            source: "inngest/booking-emails",
            error: result,
            level: "error",
            message: `Failed to send reminder email (${type}) to student`,
            context: { sessionId, studentId, type },
          });
        }
      });
    }

    return { success: true, sessionId, type };
  }
);

/**
 * Handles session cancellation emails sent to both student and instructor.
 *
 * Triggered by: `session/cancelled-email`
 *
 * Sends cancellation notification to the student and (if instructor.userId exists)
 * to the instructor. Uses separate email templates for each recipient.
 * Gracefully handles missing instructor userId by reporting and skipping.
 *
 * @returns Object with success status and sessionId
 */
export const handleSessionCancellationEmails = inngest.createFunction(
  {
    id: "handle-session-cancellation-emails",
    name: "Handle Session Cancellation Emails",
    retries: 2,
  },
  { event: "session/cancelled-email" },
  async ({ event, step }) => {
    const { sessionId, sessionPackId, studentId, instructorId, scheduledAt, cancelledBy } = event.data;

    const session = await step.run("get-session", () => getSessionById(sessionId));
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const instructor = await step.run("get-instructor", () => getInstructorById(instructorId));
    if (!instructor) {
      throw new Error(`Instructor not found: ${instructorId}`);
    }

    const hasInstructorUserId = !!instructor.userId;

    if (!hasInstructorUserId) {
      await reportError({
        source: "inngest/booking-emails",
        error: new Error("Cannot send instructor cancellation email: instructor.userId is null"),
        level: "error",
        message: "Cannot send instructor cancellation email: instructor.userId is null. Fix: Set userId on instructor via admin instructor edit page (/admin/instructors/[id]/edit). Instructor ID: " + instructorId,
        context: { sessionId, instructorId },
      });
    }

    const [studentName, instructorName, studentEmail, instructorUserEmail] = await Promise.all([
      step.run("get-student-name", () => getClerkUserName(studentId)),
      step.run("get-instructor-name", () =>
        instructor.userId
          ? getClerkUserName(instructor.userId)
          : Promise.resolve(instructor.name || "your instructor")
      ),
      step.run("get-student-email", () => getUserEmail(studentId)),
      step.run("get-instructor-email", () => instructor.userId ? getUserEmail(instructor.userId) : Promise.resolve(null)),
    ]);

    const student = await step.run("get-student-user", () => getUserById(studentId));
    const instructorUser = await step.run("get-instructor-user", () => instructor.userId ? getUserById(instructor.userId) : Promise.resolve(null));

    const studentTimeZone = student?.timeZone;
    const instructorTimeZone = instructorUser?.timeZone;

    if (studentEmail) {
      const emailContent = buildCancellationEmail(
        event.data,
        studentName,
        instructorName,
        studentTimeZone,
        true
      );

      await step.run("send-student-cancellation", async () => {
        const result = await sendEmail({
          to: studentEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: "Cancellation email sent to student",
            context: { sessionId, studentId, emailId: result.id },
          });
        }
      });
    }

    if (instructorUserEmail) {
      const emailContent = buildCancellationEmail(
        event.data,
        instructorName,
        studentName,
        instructorTimeZone,
        false
      );

      await step.run("send-instructor-cancellation", async () => {
        const result = await sendEmail({
          to: instructorUserEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: "Cancellation email sent to instructor",
            context: { sessionId, instructorId, emailId: result.id },
          });
        }
      });
    }

    return { success: true, sessionId };
  }
);

/**
 * Schedules session reminder emails when a session is scheduled.
 *
 * Triggered by: `session/scheduled`
 *
 * Uses Inngest's step.sleep to wait until the appropriate times:
 * - 24 hours before session: sends session/reminder-email with type "24h_before"
 * - 1 hour before session: sends session/reminder-email with type "1h_before"
 *
 * Each reminder is only sent if the session is still in "scheduled" status
 * at the time (idempotent check).
 *
 * @returns Object with success status and sessionId
 */
export const scheduleSessionReminders = inngest.createFunction(
  {
    id: "schedule-session-reminders",
    name: "Schedule Session Reminders",
    retries: 2,
  },
  { event: "session/scheduled" },
  async ({ event, step }) => {
    const { sessionId, sessionPackId, scheduledAt } = event.data;
    const sessionDate = new Date(scheduledAt);

    const reminder24h = new Date(sessionDate.getTime() - 24 * 60 * 60 * 1000);
    const reminder1h = new Date(sessionDate.getTime() - 60 * 60 * 1000);
    const now = new Date();

    if (reminder24h > now) {
      await step.sleep("wait-24h", reminder24h.getTime() - now.getTime());

      const session24h = await step.run("check-session-24h", async () => {
        return await getSessionById(sessionId);
      });
      if (session24h && session24h.status === "scheduled") {
        await step.run("send-24h-reminder", async () => {
          const pack = await getSessionPackById(sessionPackId);
          if (pack) {
            await inngest.send({
              name: "session/reminder-email",
              data: {
                type: "24h_before",
                sessionId,
                sessionPackId,
                studentId: pack.userId,
                instructorId: session24h.instructorId,
                scheduledAt,
              },
            });
          }
        });
      }
    }

    if (reminder1h > now) {
      await step.sleep("wait-1h", reminder1h.getTime() - now.getTime());

      const session1h = await step.run("check-session-1h", async () => {
        return await getSessionById(sessionId);
      });
      if (session1h && session1h.status === "scheduled") {
        await step.run("send-1h-reminder", async () => {
          const pack = await getSessionPackById(sessionPackId);
          if (pack) {
            await inngest.send({
              name: "session/reminder-email",
              data: {
                type: "1h_before",
                sessionId,
                sessionPackId,
                studentId: pack.userId,
                instructorId: session1h.instructorId,
                scheduledAt,
              },
            });
          }
        });
      }
    }

    return { success: true, sessionId };
  }
);
