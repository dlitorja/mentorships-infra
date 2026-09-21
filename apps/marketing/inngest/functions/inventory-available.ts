import { inngest } from "../client";
import { getInstructorBySlug } from "@/lib/instructors";
import { buildWaitlistNotificationEmail } from "@/lib/email/waitlist-notification";
import { getResendClient, getFromAddress } from "@/lib/email/client";
import { z } from "zod";
import { convexServerCall } from "@/lib/convex-server-call";

const inventoryEventSchema = z.object({
  instructorSlug: z.string(),
  type: z.enum(["one-on-one", "group"]),
});

type UnnotifiedWaitlistResponse = {
  success: boolean;
  items: { id: string; email: string; createdAt: number }[];
};

type MarkNotifiedResponse = { success: boolean; count: number };

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
    const resend = getResendClient();
    const from = getFromAddress();

    const eventParseResult = inventoryEventSchema.safeParse(event.data);
    if (!eventParseResult.success) {
      console.error("Invalid inventory event data:", eventParseResult.error.format());
      throw new Error(`Invalid inventory event: ${eventParseResult.error.message}`);
    }
    const { instructorSlug, type } = eventParseResult.data;

    if (!resend || !from) {
      return {
        message: "Email provider not configured, skipping send",
        count: 0,
        instructorSlug,
        type,
        skipped: true,
      };
    }

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

    const waitlistResult = await step.run("fetch-unnotified-entries", async () => {
      return convexServerCall<UnnotifiedWaitlistResponse>("/waitlist/unnotified", {
        instructorSlug,
        mentorshipType: type,
      });
    });

    const entries = waitlistResult.items || [];

    if (entries.length === 0) {
      return {
        message: "No waitlist entries to notify",
        count: 0,
        instructorSlug,
        type,
      };
    }

    const uniqueEmails = [...new Set(entries.map((entry) => entry.email))];

    const emailContent = await step.run("build-email-content", async (): Promise<ReturnType<typeof buildWaitlistNotificationEmail>> => {
      return buildWaitlistNotificationEmail({
        instructorName: instructor.name,
        mentorshipType: type,
        purchaseUrl: offer.url,
      });
    });

    type EmailSendResult = { status: "fulfilled"; value: { id: string } } | { status: "rejected"; reason: string };

    const sendResultsSettled = await step.run("send-emails", async (): Promise<{sendResults: EmailSendResult[]; failedCount: number; resendErrorEmails: string[]}> => {
      const sendResults: EmailSendResult[] = [];
      const REQUESTS_PER_SECOND = 2;
      const delayMs = 1000 / REQUESTS_PER_SECOND;
      let failedCount = 0;
      const resendErrorEmails: string[] = [];

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
            sendResults.push({ status: "rejected", reason: String(result.error) || "Unknown error" });
            failedCount++;
            resendErrorEmails.push(email);
          } else {
            sendResults.push({ status: "fulfilled", value: result.data });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error) || "Unknown error";
          sendResults.push({ status: "rejected", reason });
          failedCount++;
        }

        if (i < uniqueEmails.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return { sendResults, failedCount, resendErrorEmails };
    });

    const { sendResults, failedCount, resendErrorEmails } = sendResultsSettled;

    const emailToIdMap = new Map<string, string[]>();
    entries.forEach((row) => {
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
        return convexServerCall<MarkNotifiedResponse>("/waitlist/mark-notified", {
          ids: successfulIds,
        });
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
