import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
import { inngest } from "@/lib/inngest";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const WaitlistNotifySchema = z.object({
  instructorSlug: z.string().nonempty(),
  type: z.string().nonempty(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  let user = null;
  try {
    user = await currentUser();
  } catch (e) {
    console.error("Auth error:", e);
    return NextResponse.json(
      { error: "Authentication service error" },
      { status: 502 }
    );
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = WaitlistNotifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { instructorSlug, type } = parsed.data;

    const result = await inngest.send({
      name: "waitlist/notify-users",
      data: {
        instructorSlug,
        type,
        triggeredBy: user.emailAddresses?.[0]?.emailAddress || "unknown",
      },
    });

    if (result) {
      return NextResponse.json({
        success: false,
        error: "Failed to queue notification job",
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: entries } = await supabase
      .from("marketing_waitlist")
      .select("email")
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .or(`notified.eq.false,last_notification_at.lt.${oneWeekAgo}`);

    const uniqueEmails = [...new Set(entries?.map((e) => e.email) || [])];

    return NextResponse.json({
      success: true,
      message: `${uniqueEmails.length} notifications queued`,
      notifiedEmails: uniqueEmails.slice(0, 10),
      totalEmails: uniqueEmails.length,
    });
  } catch (error) {
    console.error("Error sending notifications:", error);
    return NextResponse.json(
      { error: "Failed to send notifications" },
      { status: 500 }
    );
  }
}
