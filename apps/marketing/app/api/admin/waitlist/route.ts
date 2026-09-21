import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { isAdmin } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { z } from "zod";

const WaitlistQuerySchema = z.object({
  instructor: z.string().min(1),
  type: z.string().min(1),
});

const TYPE_MAP: Record<"oneOnOne" | "group", string> = {
  oneOnOne: "one-on-one",
  group: "group",
};

function mapMentorshipType(input: string): "oneOnOne" | "group" | null {
  if (input === "one-on-one" || input === "oneOnOne") return "oneOnOne";
  if (input === "group") return "group";
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
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
    const mentorshipType = mapMentorshipType(type);
    if (!mentorshipType) {
      return NextResponse.json({ error: "Invalid mentorship type" }, { status: 400 });
    }

    const convex = getConvexClient();
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

    const formatted = entries.map((entry) => ({
      id: entry._id,
      email: entry.email,
      instructor_slug: instructorSlug,
      mentorship_type: TYPE_MAP[entry.mentorshipType] ?? entry.mentorshipType,
      notified: !!entry.notifiedAt,
      created_at: new Date(entry.createdAt).toISOString(),
    }));

    return NextResponse.json({ entries: formatted, totalCount: formatted.length });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
