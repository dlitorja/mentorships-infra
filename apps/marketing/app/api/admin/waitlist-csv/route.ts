import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { isAdmin } from "@/lib/auth";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { z } from "zod";
import { rateLimit } from "@/lib/utils";

const WaitlistQuerySchema = z.object({
  instructor: z.string().min(1),
  type: z.string().min(1),
});

const TYPE_MAP = {
  oneOnOne: "one-on-one",
  group: "group",
} as const;

function mapMentorshipType(input: string): "oneOnOne" | "group" | null {
  if (input === "one-on-one" || input === "oneOnOne") return "oneOnOne";
  if (input === "group") return "group";
  return null;
}

function sanitizeCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("=") || trimmed.startsWith("+") || trimmed.startsWith("-") || trimmed.startsWith("@")) {
    return "'" + trimmed;
  }
  return trimmed.replace(/"/g, '""');
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
    return "waitlist";
  }

  return sanitized;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
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
    const mentorshipType = mapMentorshipType(type);
    if (!mentorshipType) {
      return NextResponse.json({ error: "Invalid mentorship type" }, { status: 400 });
    }

    const convex = await getAuthenticatedConvexClient();
    const entries = (await convex.query(api.waitlist.getWaitlistForInstructor, {
      instructorSlug,
      mentorshipType,
    })) as Array<{
      _id: string;
      email: string;
      mentorshipType: "oneOnOne" | "group";
      notifiedAt: number | undefined;
      createdAt: number;
    }>;

    const csvHeader = "email,instructor_slug,mentorship_type,notified,created_at\n";
    const csvRows = entries
      .map((entry) =>
        [
          `"${sanitizeCell(entry.email)}"`,
          `"${sanitizeCell(instructorSlug)}"`,
          `"${sanitizeCell(TYPE_MAP[entry.mentorshipType] ?? entry.mentorshipType)}"`,
          entry.notifiedAt ? "true" : "false",
          sanitizeCell(new Date(entry.createdAt).toISOString()),
        ].join(",")
      )
      .join("\n");

    const csvContent = csvHeader + csvRows;

    const safeSlug = sanitizeFilename(instructorSlug);
    const safeType = sanitizeFilename(type);
    const filename = `waitlist-${safeSlug}-${safeType}.csv`;

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
