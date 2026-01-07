import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    const { instructorSlug, type } = await request.json();

    if (!instructorSlug || !type) {
      return NextResponse.json(
        { error: "Missing instructorSlug or type" },
        { status: 400 }
      );
    }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: waitlistEntries, error } = await supabase
      .from("marketing_waitlist")
      .select("email, created_at")
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .or(`notified.eq.false,last_notification_at.lt.${oneWeekAgo}`);

    if (error) {
      console.error("Error fetching waitlist:", error);
      return NextResponse.json(
        { error: "Failed to fetch waitlist" },
        { status: 500 }
      );
    }

    const emails = waitlistEntries?.map((entry) => entry.email) || [];
    const uniqueEmails = [...new Set(emails)];

    let notifiedCount = 0;

    if (uniqueEmails.length > 0) {
      for (const email of uniqueEmails) {
        const { data: existing } = await supabase
          .from("marketing_waitlist")
          .select("id")
          .eq("email", email)
          .eq("instructor_slug", instructorSlug)
          .eq("mentorship_type", type)
          .single();

        if (existing) {
          await supabase
            .from("marketing_waitlist")
            .update({
              notified: true,
              last_notification_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

          notifiedCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Marked ${notifiedCount} people for notification`,
      notifiedCount,
      totalEmails: notifiedCount,
    });
  } catch (error) {
    console.error("Error sending notifications:", error);
    return NextResponse.json(
      { error: "Failed to send notifications" },
      { status: 500 }
    );
  }
}
