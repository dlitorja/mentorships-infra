import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
import { z } from "zod";
import { rateLimit } from "@/lib/utils";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const QuerySchema = z.object({
  instructor: z.string().min(1),
});

function sanitizeCell(value: string | null | undefined): string {
  if (!value) return "";
  let trimmed = value.trim();
  // Always escape double quotes first
  trimmed = trimmed.replace(/"/g, '""');
  // Then prepend single quote for formula-safe characters
  if (trimmed.startsWith("=") || trimmed.startsWith("+") || trimmed.startsWith("-") || trimmed.startsWith("@")) {
    return "'" + trimmed;
  }
  return trimmed;
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);

  if (sanitized === "") {
    return "free-mentorship-signups";
  }

  return sanitized;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  let user = null;
  try {
    user = await currentUser();
  } catch (e) {
    console.error("[free-mentorship-csv] Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimitResult = await rateLimit(`free-mentorship-csv:${user.id}`, 10, 60000);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests", resetAt: rateLimitResult.resetAt },
      { status: 429 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const params = {
      instructor: searchParams.get("instructor") || "",
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message || "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { instructor: instructorSlug } = parsed.data;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: entries, error } = await supabase
      .from("free_mentorship_signups")
      .select("name, email, portfolio_url, time_zone, art_goals, instructor_slug, created_at")
      .eq("instructor_slug", instructorSlug)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching free mentorship signups for CSV:", error);
      return NextResponse.json(
        { error: "Failed to fetch signups" },
        { status: 500 }
      );
    }

    const csvHeader = "name,email,portfolio_url,time_zone,art_goals,instructor_slug,created_at\n";
    const csvRows = (entries || []).map((entry) =>
      [
        `"${sanitizeCell(entry.name)}"`,
        `"${sanitizeCell(entry.email)}"`,
        `"${sanitizeCell(entry.portfolio_url)}"`,
        `"${sanitizeCell(entry.time_zone)}"`,
        `"${sanitizeCell(entry.art_goals)}"`,
        `"${sanitizeCell(entry.instructor_slug)}"`,
        sanitizeCell(entry.created_at),
      ].join(",")
    ).join("\n");

    const csvContent = csvHeader + csvRows;

    const safeSlug = sanitizeFilename(instructorSlug);
    const filename = `free-mentorship-${safeSlug}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
