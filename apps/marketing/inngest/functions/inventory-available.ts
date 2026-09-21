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

type UnnotifiedResponse = {
  success: boolean;
  items: { id: string; email: string; createdAt: number }[];
};

type NotifyEvent = {
  data?: {
    instructorSlug: string;
    type: string;
  };
} & Record<string, unknown>;

async function runHandleInventoryAvailable(
  event: NotifyEvent,
  step: any
): Promise<{
  message: string;
  count: number;
  failed?: number;
  instructorSlug?: string;
  type?: string;
  skipped?: boolean;
  notifiedEmails?: string[];
  totalEmails?: number;
}> {
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

  const offer = instructor.offers.find((o: any) => {
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

  const waitlistResult = (await step.run("read-eligible-entries", async () => {
    return convexServerCall<UnnotifiedResponse>("/waitlist/unnotified", {
      instructorSlug,
      mentorshipType: type,
    });
  })) as UnnotifiedResponse;

  const entries = waitlistResult.items || [];

  if (entries.length === 0) {
    return {
      message: "No waitlist entries to notify",
      count: 0,
      instructorSlug,
      type,
    };
  }

  const uniqueEmails: string[] = [...new Set(entries.map((entry: any) => entry.email as string))];

  const emailContent = (await step.run("build-email-content", async (): Promise<ReturnType<typeof buildWaitlistNotificationEmail>> => {
    return buildWaitlistNotificationEmail({
      instructorName: instructor.name,
      mentorshipType: type,
      purchaseUrl: offer.url,
    });
  })) as ReturnType<typeof buildWaitlistNotificationEmail>;

  type EmailSendResult = { status: "fulfilled"; value: { id: string } } | { status: "rejected"; reason: string };

  const sendResultsSettled = (await step.run("send-emails", async (): Promise<{sendResults: EmailSendResult[]; failedCount: number}> => {
    const sendResults: EmailSendResult[] = [];
    const REQUESTS_PER_SECOND = 2;
    const delayMs = 1000 / REQUESTS_PER_SECOND;
    let failedCount = 0;

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

    return { sendResults, failedCount };
  })) as { sendResults: EmailSendResult[]; failedCount: number };

  const { sendResults, failedCount } = sendResultsSettled;
  const successfulSends = sendResults.filter((r: EmailSendResult) => r.status === "fulfilled").length;

  if (successfulSends > 0) {
    const successfulEmails = new Set<string>();
    sendResults.forEach((result: EmailSendResult, index: number) => {
      if (result.status === "fulfilled") {
        successfulEmails.add(uniqueEmails[index]);
      }
    });
    const successfulIds: string[] = [];
    entries.forEach((row: any) => {
      if (successfulEmails.has(row.email)) successfulIds.push(row.id as string);
    });
    if (successfulIds.length > 0) {
      await step.run("mark-notified", async () => {
        return convexServerCall("/waitlist/mark-notified", { ids: successfulIds });
      });
    }
  }

  return {
    message: `Sent ${successfulSends} emails to waitlist (${failedCount} failed)`,
    count: successfulSends,
    failed: failedCount,
    instructorSlug,
    type,
    notifiedEmails: uniqueEmails.slice(0, 5),
    totalEmails: uniqueEmails.length,
  };
}

export const handleInventoryAvailable = inngest.createFunction(
  {
    id: "handle-inventory-available",
    retries: 3,
    concurrency: {
      limit: 1,
      key: "event.data.instructorSlug + ':' + event.data.type",
    },
  },
  { event: "inventory/available" },
  async ({ event, step }) => {
    return runHandleInventoryAvailable(event, step);
  }
);
