import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import { getInstructorBySlug } from "@/lib/instructors";
import { buildWaitlistNotificationEmail } from "@/lib/email/waitlist-notification";
import { getResendClient, getFromAddress } from "@/lib/email/client";
import { z } from "zod";

const inventoryEventSchema = z.object({
  instructorSlug: z.string(),
  type: z.enum(["one-on-one", "group"]),
});

const waitlistEntrySchema = z.object({
  id: z.string(),
  email: z.string().email(),
});

export const handleInventoryAvailable = inngest.createFunction(
  {
    id: "handle-inventory-available",
    retries: 3,
  },
  { event: "inventory/available" },
  async ({ event, step }): Promise<{
    message: string;
    count: number;
    failed?: number;
    instructorSlug?: string;
    type?: string;
    skipped?: boolean;
    notifiedEmails?: string[];
    totalEmails?: number;
  }> => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase not configured");
    }

    const resend = getResendClient();
    const from = getFromAddress();

    const parsedEvent = inventoryEventSchema.parse(event.data);
    const { instructorSlug, type } = parsedEvent;

    if (!resend || !from) {
      return {
        message: "Email provider not configured, skipping send",
        count: 0,
        instructorSlug: parsedEvent.instructorSlug,
        type: parsedEvent.type,
        skipped: true,
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
        .or(`notified.eq.false,last_notification_at.lt.${oneWeekAgo},last_notification_at.is.null`);

      if (error) {
        console.error("Error fetching waitlist:", error);
        throw error;
      }

      return z.array(waitlistEntrySchema).parse(data || []);
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
        mentorshipType: type,
        purchaseUrl: offer.url,
      });
    });

    const sendResultsSettled = await step.run("send-emails", async () => {
      const sendResults = await Promise.allSettled(
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

      let failedCount = 0;
      const resendErrorEmails: string[] = [];

      sendResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const email = uniqueEmails[index];
          const reason = result.reason?.toString() || "Unknown error";
          console.error(`Failed to send email to ${email}: ${reason}`);
          failedCount++;
        } else if (result.status === "fulfilled") {
          const email = uniqueEmails[index];
          if (result.value.error || result.value.data === null) {
            console.error(`API error sending email to ${email}:`, result.value.error);
            failedCount++;
            resendErrorEmails.push(email);
          }
        }
      });

      return { sendResults, failedCount, resendErrorEmails };
    });

    const { sendResults, failedCount, resendErrorEmails } = sendResultsSettled;

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

      return z.array(waitlistEntrySchema).parse(data || []);
    });

    const emailToIdMap = new Map<string, string>();
    matchingRows.forEach((row) => {
      emailToIdMap.set(row.email, row.id);
    });

    const successfulIds: string[] = [];
    sendResults.forEach((result, index) => {
      if (result.status === "fulfilled" && !resendErrorEmails.includes(uniqueEmails[index])) {
        const sentEmail = uniqueEmails[index];
        const id = emailToIdMap.get(sentEmail);
        if (id) {
          successfulIds.push(id);
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
      message: `Marked ${successfulIds.length} emails as sent (attempted ${uniqueEmails.length})`,
      count: successfulIds.length,
      failed: failedCount,
      instructorSlug,
      type,
      notifiedEmails: uniqueEmails.slice(0, 5),
      totalEmails: uniqueEmails.length,
    };
  }
);
