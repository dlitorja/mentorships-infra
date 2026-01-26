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

    const waitlistEntries = await step.run("fetch-waitlist-entries", async () => {
      const { data, error } = await supabase
        .from("marketing_waitlist")
        .select("id, email")
        .eq("instructor_slug", instructorSlug)
        .eq("mentorship_type", type);

      if (error) {
        console.error("Error fetching waitlist:", error);
        throw error;
      }

      return data || [];
    });

    const uniqueEmails = [...new Set(waitlistEntries.map((entry) => entry.email) || [])];

    if (uniqueEmails.length === 0) {
      return {
        message: "No waitlist entries to notify",
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

    type EmailSendResult = { status: "fulfilled"; value: { id: string } } | { status: "rejected"; reason: string };

    const sendResults = await step.run("send-emails", async (): Promise<EmailSendResult[]> => {
      const results: EmailSendResult[] = [];
      const REQUESTS_PER_SECOND = 2;
      const delayMs = 1000 / REQUESTS_PER_SECOND;

      for (let i = 0; i < uniqueEmails.length; i++) {
        const email = uniqueEmails[i];
        try {
          const result = await resend.emails.send({
            from,
            to: email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
            headers: emailContent.headers,
          });
          if (result.error || result.data === null) {
            console.error(`API error sending email to ${email}:`, result.error);
            results.push({ status: "rejected", reason: String(result.error) || "Unknown error" });
          } else {
            results.push({ status: "fulfilled", value: result.data });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error) || "Unknown error";
          results.push({ status: "rejected", reason });
          console.error(`Failed to send email to ${email}:`, reason);
        }

        if (i < uniqueEmails.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return results;
    });

    const successful = sendResults.filter((r) => r.status === "fulfilled").length;
    const failed = sendResults.filter((r) => r.status === "rejected").length;

    const matchingRows = await step.run("fetch-matching-rows", async () => {
      const { data, error: selectError } = await supabase
        .from("marketing_waitlist")
        .select("id, email")
        .in("email", uniqueEmails)
        .eq("instructor_slug", instructorSlug)
        .eq("mentorship_type", type);

      if (selectError) {
        console.error("Error fetching matching rows:", selectError);
        throw selectError;
      }

      return data || [];
    });

    const emailToIdMap = new Map<string, string[]>();
    matchingRows.forEach((row) => {
      if (!emailToIdMap.has(row.email)) {
        emailToIdMap.set(row.email, []);
      }
      emailToIdMap.get(row.email)!.push(row.id);
    });

    const successfulIds: string[] = [];
    sendResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const sentEmail = uniqueEmails[index];
        const ids = emailToIdMap.get(sentEmail);
        if (ids) {
          successfulIds.push(...ids);
        }
      }
    });

    if (successfulIds.length > 0) {
      await step.run("mark-notified", async () => {
        const { error: updateError } = await supabase
          .from("marketing_waitlist")
          .update({
            notified: true,
            last_notification_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in("id", successfulIds);

        if (updateError) {
          console.error("Error updating waitlist entries:", updateError);
          throw updateError;
        }
      });
    }

    return {
      message: `Sent ${successful} emails to waitlist`,
      count: successful,
      failed,
      instructorSlug,
      type,
      notifiedEmails: uniqueEmails.slice(0, 5),
      totalEmails: uniqueEmails.length,
    };
  }
);
