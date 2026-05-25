import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

const postSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  instructorSlug: z.string().optional(),
  type: z.enum(["one-on-one", "group"]).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const { email, instructorSlug, type } = parsed.data;
    const convex = getConvexClient();

    const mentorshipType = type === "one-on-one" ? "oneOnOne" : type === "group" ? "group" : "oneOnOne";
    const slug = instructorSlug && instructorSlug.trim() ? instructorSlug.trim() : "general";

    // Use Convex waitlist mutation
    await convex.mutation(api.waitlist.addToWaitlist as any, {
      email,
      instructorSlug: slug,
      mentorshipType,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Waitlist POST error:", error);
    return NextResponse.json({ error: "Failed to join waitlist" }, { status: 500 });
  }
}

// Check waitlist status for a specific email + instructorSlug (both required)
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");
    const instructorSlug = searchParams.get("instructorSlug");

    if (!email || !instructorSlug) {
      return NextResponse.json({ onWaitlist: false, entries: [] });
    }

    const convex = getConvexClient();
    const status = await convex.query(api.waitlist.getWaitlistStatus, {
      email: email.trim().toLowerCase(),
      instructorSlug,
    } as any);

    return NextResponse.json({
      onWaitlist: !!status?.onWaitlist,
      entries: status?.onWaitlist
        ? [
            {
              id: `${email}:${instructorSlug}`,
              instructorSlug,
              type: status.mentorshipType,
              createdAt: status.createdAt ? new Date(status.createdAt).toISOString() : null,
            },
          ]
        : [],
    });
  } catch (error) {
    console.error("Waitlist GET error:", error);
    return NextResponse.json({ error: "Failed to fetch waitlist status" }, { status: 500 });
  }
}
