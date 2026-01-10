import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { buildWeeklyDigestEmail } from "@/lib/email/weekly-digest";
import { getWeeklyDigestData, getPeriodForDigest } from "@/lib/digest-data";
import { getResendClient, getFromAddress } from "@/lib/email/client";
import { rateLimit } from "@/lib/utils";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const rateLimitResult = await rateLimit("digest-send", 5, 60000);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests", resetAt: rateLimitResult.resetAt },
        { status: 429 }
      );
    }

    await requireAdmin();

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const resend = getResendClient();
    const from = getFromAddress();

    if (!resend || !from) {
      return NextResponse.json(
        { error: "Email provider not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: settings, error: settingsError } = await supabase
      .from("admin_digest_settings")
      .select("*")
      .eq("id", "default")
      .single();

    if (settingsError || !settings) {
      console.error("Error fetching digest settings:", settingsError);
      return NextResponse.json(
        { error: "Failed to fetch digest settings" },
        { status: 500 }
      );
    }

    const period = getPeriodForDigest(settings.frequency);

    const digestData = await getWeeklyDigestData(period.start, period.end);

    const emailContent = buildWeeklyDigestEmail(digestData);

    const sendResult = await resend.emails.send({
      from,
      to: settings.admin_email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      headers: emailContent.headers,
    });

    if (sendResult.error) {
      console.error("Failed to send digest email:", sendResult.error);
      return NextResponse.json(
        { error: "Failed to send digest email", details: sendResult.error },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabase
      .from("admin_digest_settings")
      .update({
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");

    if (updateError) {
      console.error("Error updating last_sent_at:", updateError);
    }

    return NextResponse.json({
      success: true,
      message: "Digest sent successfully",
      recipientEmail: settings.admin_email,
      periodStart: digestData.periodStart,
      periodEnd: digestData.periodEnd,
      newSignups: digestData.waitlistSignups.length,
      emailsSent: digestData.notificationsSent.reduce((sum, n) => sum + n.count, 0),
      conversions: digestData.conversions.length,
      emailId: sendResult.data?.id,
    });
  } catch (error) {
    console.error("Error in POST /api/admin/digest-send:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
