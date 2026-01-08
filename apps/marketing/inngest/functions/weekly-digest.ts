import { inngest } from "../client";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { buildWeeklyDigestEmail } from "@/lib/email/weekly-digest";
import { getWeeklyDigestData, getPeriodForDigest } from "@/lib/digest-data";

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

      return data;
    });

    if (!settings || !settings.enabled) {
      return {
        message: "Digest is disabled in settings",
        skipped: true,
        enabled: settings?.enabled,
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
      emailId: sendResult.data?.id || sendResult.error?.message,
    };
  }
);

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

      return data;
    });

    if (!settings || !settings.enabled) {
      return {
        message: "Digest is disabled in settings",
        skipped: true,
        enabled: settings?.enabled,
      };
    }

    const now = new Date();
    const shouldSendDaily = settings.frequency === "daily";
    const shouldSendWeekly = settings.frequency === "weekly" && now.getDay() === 1;
    const shouldSendMonthly = settings.frequency === "monthly" && now.getDate() === 1;

    if (!shouldSendDaily && !shouldSendWeekly && !shouldSendMonthly) {
      return {
        message: "Not scheduled to send today based on frequency settings",
        skipped: true,
        frequency: settings.frequency,
        dayOfWeek: now.getDay(),
        dayOfMonth: now.getDate(),
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
      message: "Digest sent successfully",
      frequency: settings.frequency,
      recipientEmail: settings.admin_email,
      periodStart: digestData.periodStart,
      periodEnd: digestData.periodEnd,
      newSignups: digestData.waitlistSignups.length,
      emailsSent: digestData.notificationsSent.reduce((sum, n) => sum + n.count, 0),
      conversions: digestData.conversions.length,
      emailId: sendResult.data?.id || sendResult.error?.message,
    };
  }
);
