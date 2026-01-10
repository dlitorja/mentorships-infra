import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import { buildWeeklyDigestEmail } from "@/lib/email/weekly-digest";
import { getWeeklyDigestData, getPeriodForDigest } from "@/lib/digest-data";
import { getResendClient, getFromAddress } from "@/lib/email/client";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const digestSettingsSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  admin_email: z.string().email(),
  last_sent_at: z.string().nullable(),
  updated_at: z.string(),
});

export const sendScheduledDigestByFrequency = inngest.createFunction(
  {
    id: "send-digest-by-frequency",
    retries: 3,
  },
  { cron: "0 9 * * *" },
  async ({ step }) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase not configured");
    }

    const resend = getResendClient();
    const from = getFromAddress();

    if (!resend || !from) {
      return {
        message: "Email provider not configured, skipping digest",
        skipped: true,
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const settings = await step.run("fetch-digest-settings", async () => {
      const { data, error } = await supabase
        .from("admin_digest_settings")
        .select("*")
        .eq("id", "default")
        .single();

      if (error) {
        console.error("Error fetching digest settings:", error);
        throw error;
      }

      return digestSettingsSchema.parse(data);
    });

    if (!settings || !settings.enabled) {
      return {
        message: "Digest is disabled in settings",
        skipped: true,
        enabled: settings?.enabled,
      };
    }

    const startTime = new Date();
    const shouldSendDaily = settings.frequency === "daily";
    const shouldSendWeekly = settings.frequency === "weekly" && startTime.getDay() === 1;
    const shouldSendMonthly = settings.frequency === "monthly" && startTime.getDate() === 1;

    if (!shouldSendDaily && !shouldSendWeekly && !shouldSendMonthly) {
      return {
        message: "Not scheduled to send today based on frequency settings",
        skipped: true,
        frequency: settings.frequency,
        dayOfWeek: startTime.getDay(),
        dayOfMonth: startTime.getDate(),
      };
    }

    const period = getPeriodForDigest(settings.frequency);

    const digestData = await step.run("gather-digest-data", async () => {
      return getWeeklyDigestData(period.start, period.end);
    });

    const emailContent = await step.run("build-email-content", async () => {
      return buildWeeklyDigestEmail(digestData);
    });

    const sendResult = await step.run("send-digest-email", async () => {
      const result = await resend.emails.send({
        from,
        to: settings.admin_email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: emailContent.headers,
      });

      return result;
    });

    if (sendResult.error) {
      console.error("Failed to send digest email:", sendResult.error);
      return {
        message: "Failed to send digest email",
        error: sendResult.error,
      };
    }

    await step.run("update-last-sent", async () => {
      const { error } = await supabase
        .from("admin_digest_settings")
        .update({
          last_sent_at: startTime.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", "default");

      if (error) {
        console.error("Error updating last_sent_at:", error);
        throw error;
      }
    });

    return {
      message: "Digest sent successfully",
      frequency: settings.frequency,
      recipientEmail: settings.admin_email,
      periodStart: digestData.periodStart,
      periodEnd: digestData.periodEnd,
      newSignups: digestData.waitlistSignups.length,
      emailsSent: digestData.notificationsSent.reduce((sum, n) => sum + n.count, 0),
      conversions: digestData.conversions.length,
      emailId: sendResult.data?.id,
    };
  }
);

export const sendWeeklyDigest = inngest.createFunction(
  {
    id: "send-weekly-digest",
    retries: 3,
  },
  { cron: "0 9 * * 1" },
  async ({ step }) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase not configured");
    }

    const resend = getResendClient();
    const from = getFromAddress();

    if (!resend || !from) {
      return {
        message: "Email provider not configured, skipping digest",
        skipped: true,
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const settings = await step.run("fetch-digest-settings", async () => {
      const { data, error } = await supabase
        .from("admin_digest_settings")
        .select("*")
        .eq("id", "default")
        .single();

      if (error) {
        console.error("Error fetching digest settings:", error);
        throw error;
      }

      return digestSettingsSchema.parse(data);
    });

    if (!settings || !settings.enabled) {
      return {
        message: "Digest is disabled in settings",
        skipped: true,
        enabled: settings?.enabled,
      };
    }

    if (settings.frequency !== "weekly") {
      return {
        message: "Skipping weekly digest - frequency is not set to weekly",
        skipped: true,
        frequency: settings.frequency,
      };
    }

    const period = getPeriodForDigest("weekly");

    const digestData = await step.run("gather-digest-data", async () => {
      return getWeeklyDigestData(period.start, period.end);
    });

    const emailContent = await step.run("build-email-content", async () => {
      return buildWeeklyDigestEmail(digestData);
    });

    const sendResult = await step.run("send-digest-email", async () => {
      const result = await resend.emails.send({
        from,
        to: settings.admin_email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: emailContent.headers,
      });

      return result;
    });

    if (sendResult.error) {
      console.error("Failed to send weekly digest email:", sendResult.error);
      return {
        message: "Failed to send weekly digest email",
        error: sendResult.error,
      };
    }

    await step.run("update-last-sent", async () => {
      const { error } = await supabase
        .from("admin_digest_settings")
        .update({
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", "default");

      if (error) {
        console.error("Error updating last_sent_at:", error);
        throw error;
      }
    });

    return {
      message: "Weekly digest sent successfully",
      recipientEmail: settings.admin_email,
      periodStart: digestData.periodStart,
      periodEnd: digestData.periodEnd,
      newSignups: digestData.waitlistSignups.length,
      emailsSent: digestData.notificationsSent.reduce((sum, n) => sum + n.count, 0),
      conversions: digestData.conversions.length,
      emailId: sendResult.data?.id,
    };
  }
);
