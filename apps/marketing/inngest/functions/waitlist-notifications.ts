import { inngest } from "../client";
import { Resend } from "resend";
import { getInstructorBySlug } from "@/lib/instructors";
import { buildWaitlistNotificationEmail } from "@/lib/email/waitlist-notification";
import { resolveFrom } from "../../../../packages/emails/src/envelope";
import { convexServerCall } from "@/lib/convex-server-call";

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
  const from = resolveFrom("marketing");
  if (!from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_FROM_MARKETING is not set (required in production)");
    }
    return null;
  }
  return from;
}

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

async function runProcessWaitlistNotifications(
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

  if (!resend || !from) {
    return {
      message: "Email provider not configured, skipping send",
      count: 0,
      instructorSlug: event.data?.instructorSlug ?? "",
      type: event.data?.type ?? "",
      skipped: true,
    };
  }

  const { instructorSlug, type } = event.data ?? { instructorSlug: "", type: "" };

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

  const emailContent = (await step.run("build-email-content", async () => {
    return buildWaitlistNotificationEmail({
      instructorName: instructor.name,
      mentorshipType,
      purchaseUrl: offer.url,
    });
  })) as ReturnType<typeof buildWaitlistNotificationEmail>;

  type EmailSendResult = { status: "fulfilled"; value: { id: string } } | { status: "rejected"; reason: string };

  const sendResults = (await step.run("send-emails", async (): Promise<EmailSendResult[]> => {
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
  })) as EmailSendResult[];

  const successful = sendResults.filter((r: EmailSendResult) => r.status === "fulfilled").length;
  const failed = sendResults.filter((r: EmailSendResult) => r.status === "rejected").length;

  const successfulIds: string[] = [];
  if (successful > 0) {
    const successfulEmails = new Set<string>();
    sendResults.forEach((result: EmailSendResult, index: number) => {
      if (result.status === "fulfilled") {
        successfulEmails.add(uniqueEmails[index]);
      }
    });
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
    message: `Sent ${successful} emails to waitlist (${failed} failed)`,
    count: successful,
    failed,
    instructorSlug,
    type,
    notifiedEmails: uniqueEmails.slice(0, 5),
    totalEmails: uniqueEmails.length,
  };
}

export const processWaitlistNotifications = inngest.createFunction(
  {
    id: "process-waitlist-notifications",
    retries: 3,
    concurrency: {
      limit: 1,
      key: "event.data.instructorSlug + ':' + event.data.type",
      scope: "account",
    },
  },
  { event: "waitlist/notify-users" },
  async ({ event, step }) => {
    return runProcessWaitlistNotifications(event, step);
  }
);
