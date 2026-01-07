import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const WaitlistQuerySchema = z.object({
  instructor: z.string().min(1),
  type: z.string().min(1),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  let user = null;
  try {
    user = await currentUser();
  } catch (e) {
    console.error("[waitlist] Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const params = {
      instructor: searchParams.get("instructor") || "",
      type: searchParams.get("type") || "",
    };

    const parsed = WaitlistQuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message || "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { instructor: instructorSlug, type } = parsed.data;
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
