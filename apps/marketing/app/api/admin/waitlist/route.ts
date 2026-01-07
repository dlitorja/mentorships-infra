import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  let userId: string | null = null;
  try {
    const authResult = await auth();
    userId = authResult.userId;
  } catch (e) {
    console.error("[waitlist] Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const instructorSlug = searchParams.get("instructor");
    const type = searchParams.get("type");

    if (!instructorSlug || !type) {
      return NextResponse.json(
        { error: "Missing instructor or type" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: entries, error } = await supabase
      .from("marketing_waitlist")
      .select("id, email, instructor_slug, mentorship_type, notified, created_at")
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching waitlist:", error);
      return NextResponse.json(
        { error: "Failed to fetch waitlist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ entries: entries || [] });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
