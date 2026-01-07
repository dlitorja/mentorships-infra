import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
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
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: waitlistEntries, error } = await supabase
      .from("marketing_waitlist")
      .select("id, email")
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

    const uniqueEmails = [...new Set(waitlistEntries?.map((entry) => entry.email) || [])];
    let notifiedCount = 0;

    if (uniqueEmails.length > 0) {
      const { data: matchingRows, error: selectError } = await supabase
        .from("marketing_waitlist")
        .select("id, email")
        .in("email", uniqueEmails)
        .eq("instructor_slug", instructorSlug)
        .eq("mentorship_type", type);

      if (selectError) {
        console.error("Error fetching matching rows:", selectError);
        return NextResponse.json(
          { error: "Failed to fetch matching entries" },
          { status: 500 }
        );
      }

      const idsToUpdate = matchingRows?.map((row) => row.id).filter(Boolean) || [];

      if (idsToUpdate.length > 0) {
        const { error: updateError } = await supabase
          .from("marketing_waitlist")
          .update({
            notified: true,
            last_notification_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in("id", idsToUpdate);

        if (updateError) {
          console.error("Error updating waitlist entries:", updateError);
          return NextResponse.json(
            { error: "Failed to update entries" },
            { status: 500 }
          );
        }

        notifiedCount = idsToUpdate.length;
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
