import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request: NextRequest) {
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
    console.error("Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { ids } = await request.json();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "No IDs provided" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { error, count } = await supabase
      .from("marketing_waitlist")
      .delete()
      .in("id", ids);

    if (error) {
      console.error("Error deleting waitlist entries:", error);
      return NextResponse.json(
        { error: "Failed to delete entries" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedCount: count || 0,
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
