import { inngest } from "../client";
import { getUserById, getMentorById, getSessionById, getSessionPackById } from "@mentorships/db";
import { clerkClient } from "@clerk/nextjs/server";
import { sendEmail } from "@/lib/email";
import {
  buildBookingConfirmationEmail,
  buildMentorNotificationEmail,
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

export const handleSessionBookingEmails = inngest.createFunction(
  {
    id: "handle-session-booking-emails",
    name: "Handle Session Booking Emails",
    retries: 2,
  },
  { event: "session/booking-email" },
  async ({ event, step }) => {
    const { type, sessionId, sessionPackId, studentId, mentorId, scheduledAt } = event.data;

    const [session, pack, mentor] = await Promise.all([
      step.run("get-session", () => getSessionById(sessionId)),
      step.run("get-pack", () => getSessionPackById(sessionPackId)),
      step.run("get-mentor", () => getMentorById(mentorId)),
    ]);

    if (!session || !pack || !mentor) {
      throw new Error(`Missing session, pack, or mentor for booking email`);
    }

    const [studentName, mentorName, studentEmail, mentorUserEmail] = await Promise.all([
      step.run("get-student-name", () => getClerkUserName(studentId)),
      step.run("get-mentor-name", () => getClerkUserName(mentor.userId)),
      step.run("get-student-email", () => getUserEmail(studentId)),
      step.run("get-mentor-email", () => getUserEmail(mentor.userId)),
    ]);

    const student = await step.run("get-student-user", () => getUserById(studentId));
    const studentTimeZone = student?.timeZone;

    if (type === "booking_confirmation_student" && studentEmail) {
      const emailContent = buildBookingConfirmationEmail(
        event.data,
        studentName,
        mentorName,
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

    if (type === "booking_notification_mentor" && mentorUserEmail) {
      const mentorUser = await step.run("get-mentor-user", () => getUserById(mentor.userId));
      const mentorTimeZone = mentorUser?.timeZone;

      const emailContent = buildMentorNotificationEmail(
        event.data,
        mentorName,
        studentName,
        studentEmail || "Unknown",
        mentorTimeZone
      );

      await step.run("send-mentor-notification", async () => {
        const result = await sendEmail({
          to: mentorUserEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: "Booking notification sent to mentor",
            context: { sessionId, mentorId, emailId: result.id },
          });
        } else {
          await reportError({
            source: "inngest/booking-emails",
            error: result,
            level: "error",
            message: "Failed to send booking notification to mentor",
            context: { sessionId, mentorId },
          });
        }
      });
    }

    return { success: true, sessionId, type };
  }
);

export const handleSessionReminderEmails = inngest.createFunction(
  {
    id: "handle-session-reminder-emails",
    name: "Handle Session Reminder Emails",
    retries: 2,
  },
  { event: "session/reminder-email" },
  async ({ event, step }) => {
    const { type, sessionId, sessionPackId, studentId, mentorId, scheduledAt } = event.data;

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
    const mentor = await step.run("get-mentor", () => getMentorById(mentorId));

    if (!pack || !mentor) {
      throw new Error(`Missing pack or mentor for reminder email`);
    }

    const [studentName, mentorName, studentEmail] = await Promise.all([
      step.run("get-student-name", () => getClerkUserName(studentId)),
      step.run("get-mentor-name", () => getClerkUserName(mentor.userId)),
      step.run("get-student-email", () => getUserEmail(studentId)),
    ]);

    const student = await step.run("get-student-user", () => getUserById(studentId));
    const studentTimeZone = student?.timeZone;

    if (studentEmail) {
      const emailContent = buildReminderEmail(
        event.data,
        studentName,
        mentorName,
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

export const handleSessionCancellationEmails = inngest.createFunction(
  {
    id: "handle-session-cancellation-emails",
    name: "Handle Session Cancellation Emails",
    retries: 2,
  },
  { event: "session/cancelled-email" },
  async ({ event, step }) => {
    const { sessionId, sessionPackId, studentId, mentorId, scheduledAt, cancelledBy } = event.data;

    const session = await step.run("get-session", () => getSessionById(sessionId));
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const [studentName, mentorName, studentEmail, mentorUserEmail] = await Promise.all([
      step.run("get-student-name", () => getClerkUserName(studentId)),
      step.run("get-mentor-name", () => getClerkUserName(mentorId)),
      step.run("get-student-email", () => getUserEmail(studentId)),
      step.run("get-mentor-email", () => getUserEmail(mentorId)),
    ]);

    const student = await step.run("get-student-user", () => getUserById(studentId));
    const mentorUser = await step.run("get-mentor-user", () => getUserById(mentorId));

    const studentTimeZone = student?.timeZone;
    const mentorTimeZone = mentorUser?.timeZone;

    if (studentEmail) {
      const emailContent = buildCancellationEmail(
        event.data,
        studentName,
        mentorName,
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

    if (mentorUserEmail) {
      const emailContent = buildCancellationEmail(
        event.data,
        mentorName,
        studentName,
        mentorTimeZone,
        false
      );

      await step.run("send-mentor-cancellation", async () => {
        const result = await sendEmail({
          to: mentorUserEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        });

        if (result.ok) {
          await reportInfo({
            source: "inngest/booking-emails",
            message: "Cancellation email sent to mentor",
            context: { sessionId, mentorId, emailId: result.id },
          });
        }
      });
    }

    return { success: true, sessionId };
  }
);

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
                mentorId: session24h.mentorId,
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
                mentorId: session1h.mentorId,
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
