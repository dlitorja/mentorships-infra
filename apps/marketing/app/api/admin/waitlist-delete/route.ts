import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const WaitlistDeleteSchema = z.object({
  ids: z.array(z.string()).nonempty(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    console.error("Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = WaitlistDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message || "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const deleteResult = await supabase
      .from("marketing_waitlist")
      .delete()
      .in("id", ids);

    const SupabaseDeleteResponseSchema = z.object({
      error: z.any().optional(),
      count: z.number().optional(),
    });

    const parsedResult = SupabaseDeleteResponseSchema.safeParse(deleteResult);

    if (!parsedResult.success) {
      console.error("Supabase response validation failed:", deleteResult);
      return NextResponse.json(
        { error: "Invalid response from database" },
        { status: 500 }
      );
    }

    const { error, count } = parsedResult.data;

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
