import { inngest } from "../client";
import { convexServerCall } from "@/lib/convex-server-call";
import { z } from "zod";

const sendDigestResponseSchema = z.object({
  success: z.boolean(),
  result: z.object({
    success: z.boolean(),
    message: z.string(),
    recipientEmail: z.string().email(),
    periodStart: z.string(),
    periodEnd: z.string(),
    newSignups: z.number(),
    emailsSent: z.number(),
    conversions: z.number(),
    emailId: z.string(),
  }),
});

/**
 * PR 7: scheduled digest send. Calls the Convex HTTP endpoint
 * `POST /digest/send`, which runs the `internalSendScheduledDigest`
 * action. The action does its own enabled + frequency + date check
 * and either sends or returns `{ skipped: true }`. Cron: daily at
 * 09:00 UTC. Inngest is dumb on purpose — all logic lives in
 * Convex so manual "Send Now" (via `useSendDigest` →
 * `sendAdminDigestEmail` action) and scheduled sends share one
 * code path.
 *
 * Replaces the two Supabase-backed functions
 * `sendScheduledDigestByFrequency` (cron `0 9 * * *`) and
 * `sendWeeklyDigest` (cron `0 9 * * 1`) that read from
 * `lib/digest-data.ts` + `lib/email/weekly-digest.ts`. The daily
 * cron already covered Monday for `frequency === "weekly"`, so
 * consolidating to one function removes the duplicate path.
 */
export const sendScheduledDigest = inngest.createFunction(
  {
    id: "send-scheduled-digest",
    retries: 3,
  },
  { cron: "0 9 * * *" },
  async ({ step }) => {
    const result = await step.run("send-digest-via-convex", async () => {
      return await convexServerCall("/digest/send", {});
    });

    const validated = sendDigestResponseSchema.safeParse(result);
    if (!validated.success) {
      console.error(
        "Invalid /digest/send response shape:",
        validated.error.format()
      );
      throw new Error("Convex /digest/send returned unexpected shape");
    }

    return {
      message: validated.data.result.message,
      skipped: !validated.data.result.success,
      recipientEmail: validated.data.result.recipientEmail,
      periodStart: validated.data.result.periodStart,
      periodEnd: validated.data.result.periodEnd,
      newSignups: validated.data.result.newSignups,
      emailsSent: validated.data.result.emailsSent,
      conversions: validated.data.result.conversions,
      emailId: validated.data.result.emailId,
    };
  }
);
