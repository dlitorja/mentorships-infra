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

type ClaimedWaitlistResponse = {
  success: boolean;
  items: { id: string; email: string }[];
  claimedAt: number;
};

type ReleaseClaimsResponse = { success: boolean; released: number; untouched?: number };

type ClaimAndReleaseEvent = {
  data: {
    instructorSlug: string;
    type: string;
    claimedIds?: string[];
    claimedAt?: number;
  };
};

async function releaseClaimedIds(
  ids: string[],
  claimedAt: number,
  instructorSlug: string,
  type: string
): Promise<ReleaseClaimsResponse | null> {
  if (ids.length === 0) return null;
  return convexServerCall<ReleaseClaimsResponse>("/waitlist/release-specific-claims", {
    ids,
    claimedAt,
    instructorSlug,
    mentorshipType: type,
  });
}

async function releaseRecentClaims(
  instructorSlug: string,
  type: string,
  since: number,
  until: number
): Promise<ReleaseClaimsResponse | null> {
  return convexServerCall<ReleaseClaimsResponse>("/waitlist/release-recent-claims", {
    instructorSlug,
    mentorshipType: type,
    since,
    until,
  });
}

async function runHandleInventoryAvailable(
  event: ClaimAndReleaseEvent,
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
  claimedIds?: string[];
  claimedAt?: number;
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

  const waitlistResult = await step.run("claim-entries", async () => {
    return convexServerCall<ClaimedWaitlistResponse>("/waitlist/claim", {
      instructorSlug,
      mentorshipType: type,
    });
  });

  const entries = waitlistResult.items || [];
  const claimedAt = waitlistResult.claimedAt;

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

  const sendResultsSettled = await step.run("send-emails", async (): Promise<{sendResults: EmailSendResult[]; failedCount: number}> => {
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
  });

  const { sendResults, failedCount } = sendResultsSettled;

  const successfulSends = sendResults.filter((r) => r.status === "fulfilled").length;

  if (failedCount > 0 && claimedAt) {
    const failedEmails = new Set<string>();
    sendResults.forEach((result, index) => {
      if (result.status === "rejected") {
        failedEmails.add(uniqueEmails[index]);
      }
    });

    const emailToIds = new Map<string, string[]>();
    entries.forEach((row) => {
      if (!failedEmails.has(row.email)) return;
      const list = emailToIds.get(row.email);
      if (list) {
        list.push(row.id);
      } else {
        emailToIds.set(row.email, [row.id]);
      }
    });

    const failedIds: string[] = [];
    for (const ids of emailToIds.values()) {
      failedIds.push(...ids);
    }

    await releaseClaimedIds(failedIds, claimedAt, instructorSlug, type);
  }

  return {
    message: `Sent ${successfulSends} emails to waitlist (${failedCount} failed)`,
    count: successfulSends,
    failed: failedCount,
    instructorSlug,
    type,
    notifiedEmails: uniqueEmails.slice(0, 5),
    totalEmails: uniqueEmails.length,
    claimedIds: entries.map((e) => e.id),
    claimedAt,
  };
}

async function releaseAllClaimsOnFailure(
  event: ClaimAndReleaseEvent
): Promise<void> {
  const since = Date.now() - 5 * 60 * 1000;
  const until = Date.now();
  await releaseRecentClaims(event.data.instructorSlug, event.data.type, since, until);
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
  },
  { onFailure: releaseAllClaimsOnFailure as any }
);
