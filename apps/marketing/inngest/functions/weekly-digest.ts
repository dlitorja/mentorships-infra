import { inngest } from "../client";
import { convexServerCall } from "@/lib/convex-server-call";
import { z } from "zod";

/**
 * PR 7: scheduled digest send. Calls the Convex HTTP endpoint
 * `POST /digest/send`, which runs the `internalSendScheduledDigest`
 * action. The action does its own enabled + frequency + date check
 * and either:
 *   - sends the digest → returns `{ success: true, message, recipientEmail, ... }`
 *   - skips (disabled / not weekly / not monthly) → returns `{ skipped: true, reason }`
 *
 * Both are success-status responses (HTTP 200, `{ success: true, result }`),
 * so the Inngest function treats them as a discriminated union rather
 * than throwing on the skip case — a clean skip should complete the
 * Inngest step successfully and not trigger retries.
 *
 * Cron: daily at 09:00 UTC. Inngest is dumb on purpose — all logic lives
 * in Convex so manual "Send Now" (via `useSendDigest` →
 * `sendAdminDigestEmail` action) and scheduled sends share one code path.
 *
 * Replaces the two Supabase-backed functions
 * `sendScheduledDigestByFrequency` (cron `0 9 * * *`) and
 * `sendWeeklyDigest` (cron `0 9 * * 1`) that read from
 * `lib/digest-data.ts` + `lib/email/weekly-digest.ts`. The daily cron
 * already covered Monday for `frequency === "weekly"`, so consolidating
 * to one function removes the duplicate path.
 */
const sendDigestEnvelopeSchema = z.object({
  success: z.literal(true),
  result: z.union([
    z.object({
      success: z.literal(true),
      message: z.string(),
      recipientEmail: z.string().email(),
      periodStart: z.string(),
      periodEnd: z.string(),
      newSignups: z.number(),
      emailsSent: z.number(),
      conversions: z.number(),
      emailId: z.string(),
    }),
    z.object({
      skipped: z.literal(true),
      reason: z.enum(["disabled", "not-weekly", "not-monthly"]),
    }),
  ]),
});

export const sendScheduledDigest = inngest.createFunction(
  {
    id: "send-scheduled-digest",
    retries: 3,
  },
  { cron: "0 9 * * *" },
  async ({ step }) => {
    const envelope = await step.run("send-digest-via-convex", async () => {
      return await convexServerCall("/digest/send", {});
    });

    const validated = sendDigestEnvelopeSchema.safeParse(envelope);
    if (!validated.success) {
      console.error(
        "Invalid /digest/send response shape:",
        validated.error.format()
      );
      throw new Error("Convex /digest/send returned unexpected shape");
    }

    if ("skipped" in validated.data.result) {
      return { skipped: true, reason: validated.data.result.reason };
    }

    const sent = validated.data.result;
    return {
      skipped: false,
      message: sent.message,
      recipientEmail: sent.recipientEmail,
      periodStart: sent.periodStart,
      periodEnd: sent.periodEnd,
      newSignups: sent.newSignups,
      emailsSent: sent.emailsSent,
      conversions: sent.conversions,
      emailId: sent.emailId,
    };
  }
);
