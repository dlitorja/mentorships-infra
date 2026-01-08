import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { instructors, getInstructorBySlug } from "@/lib/instructors";
import { buildWaitlistNotificationEmail } from "@/lib/email/waitlist-notification";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set (required in production)");
    }
    return null;
  }

  return new Resend(apiKey);
}

function getFromAddress(): string | null {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_FROM is not set (required in production)");
    }
    return null;
  }
  return from;
}

export const processWaitlistNotifications = inngest.createFunction(
  {
    id: "process-waitlist-notifications",
    retries: 3,
  },
  { event: "waitlist/notify-users" },
  async ({ event, step }) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase not configured");
    }

    const resend = getResendClient();
    const from = getFromAddress();

    if (!resend || !from) {
      return {
        message: "Email provider not configured, skipping send",
        count: 0,
        instructorSlug: event.data.instructorSlug,
        type: event.data.type,
        skipped: true,
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { instructorSlug, type } = event.data;

    const validTypes = ["one-on-one", "group"] as const;
    if (!validTypes.includes(type as typeof validTypes[number])) {
      throw new Error(`Invalid mentorship type: ${type}`);
    }

    const mentorshipType = type as "one-on-one" | "group";

    const instructor = await step.run("get-instructor-details", async () => {
      return getInstructorBySlug(instructorSlug);
    });

    if (!instructor) {
      console.error(`Instructor not found: ${instructorSlug}`);
      throw new Error(`Instructor not found: ${instructorSlug}`);
    }

    const offer = instructor.offers.find((o) => {
      const offerKind = type === "one-on-one" ? "oneOnOne" : "group";
      return o.kind === offerKind && o.active !== false;
    });

    if (!offer) {
      console.error(`No active offer found for ${instructorSlug}/${type}`);
      return {
        message: "No active offer found for instructor/type",
        count: 0,
        instructorSlug,
        type,
        skipped: true,
      };
    }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const waitlistEntries = await step.run("fetch-waitlist-entries", async () => {
      const { data, error } = await supabase
        .from("marketing_waitlist")
        .select("id, email")
        .eq("instructor_slug", instructorSlug)
        .eq("mentorship_type", type)
        .or(`notified.eq.false,last_notification_at.lt.${oneWeekAgo}`);

      if (error) {
        console.error("Error fetching waitlist:", error);
        throw error;
      }

      return data || [];
    });

    const uniqueEmails = [...new Set(waitlistEntries.map((entry) => entry.email) || [])];

    if (uniqueEmails.length === 0) {
      return {
        message: "No entries to notify (all notified within last 7 days)",
        count: 0,
        instructorSlug,
        type,
      };
    }

    const emailContent = await step.run("build-email-content", async () => {
      return buildWaitlistNotificationEmail({
        instructorName: instructor.name,
        mentorshipType,
        purchaseUrl: offer.url,
      });
    });

    const sendResults = await step.run("send-emails", async () => {
      const results = await Promise.allSettled(
        uniqueEmails.map((email) =>
          resend.emails.send({
            from,
            to: email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
            headers: emailContent.headers,
          })
        )
      );

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const email = uniqueEmails[index];
          const reason = (result as PromiseRejectedResult).reason || "Unknown error";
          console.error(`Failed to send email to ${email}: ${reason}`);
        }
      });

      return { successful, failed, results };
    });

    const { data: matchingRows, error: selectError } = await supabase
      .from("marketing_waitlist")
      .select("id")
      .in("email", uniqueEmails)
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type);

    if (selectError) {
      console.error("Error fetching matching rows:", selectError);
      throw selectError;
    }

    const idsToUpdate = await step.run("fetch-matching-rows", async () => {
      const { data: matchingRows, error: selectError } = await supabase
        .from("marketing_waitlist")
        .select("id")
        .in("email", uniqueEmails)
        .eq("instructor_slug", instructorSlug)
        .eq("mentorship_type", type);

      if (selectError) {
        console.error("Error fetching matching rows:", selectError);
        throw selectError;
      }

      return matchingRows?.map((row) => row.id).filter(Boolean) || [];
    });

    if (idsToUpdate.length > 0) {
      await step.run("mark-notified", async () => {
        const { error: updateError } = await supabase
          .from("marketing_waitlist")
          .update({
            notified: true,
            last_notification_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in("id", idsToUpdate);

        if (updateError) {
          console.error("Error updating waitlist entries:", updateError);
          throw updateError;
        }
      });
    }

    return {
      message: `Sent ${sendResults.successful} emails to waitlist`,
      count: sendResults.successful,
      failed: sendResults.failed,
      instructorSlug,
      type,
      notifiedEmails: uniqueEmails.slice(0, 5),
      totalEmails: uniqueEmails.length,
    };
  }
);
