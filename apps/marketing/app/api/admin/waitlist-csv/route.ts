import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
import { z } from "zod";
import { rateLimit } from "@/lib/utils";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const WaitlistQuerySchema = z.object({
  instructor: z.string().min(1),
  type: z.string().min(1),
});

function sanitizeCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("=") || trimmed.startsWith("+") || trimmed.startsWith("-") || trimmed.startsWith("@")) {
    return "'" + trimmed;
  }
  return trimmed.replace(/"/g, '""');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  const rateLimitResult = await rateLimit("waitlist-csv", 10, 60000);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests", resetAt: rateLimitResult.resetAt },
      { status: 429 }
    );
  }

  let user = null;
  try {
    user = await currentUser();
  } catch (e) {
    console.error("[waitlist-csv] Auth error:", e);
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
      .select("email, instructor_slug, mentorship_type, notified, created_at")
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching waitlist for CSV:", error);
      return NextResponse.json(
        { error: "Failed to fetch waitlist" },
        { status: 500 }
      );
    }

    const csvHeader = "email,instructor_slug,mentorship_type,notified,created_at\n";
    const csvRows = (entries || []).map((entry) =>
      [
        `"${sanitizeCell(entry.email)}"`,
        `"${sanitizeCell(entry.instructor_slug)}"`,
        `"${sanitizeCell(entry.mentorship_type)}"`,
        entry.notified ? "true" : "false",
        sanitizeCell(entry.created_at),
      ].join(",")
    ).join("\n");

    const csvContent = csvHeader + csvRows;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="waitlist-${instructorSlug}-${type}.csv"`,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
