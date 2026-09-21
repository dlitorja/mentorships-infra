import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { requireAdmin } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { z } from "zod";

const TEST_INSTRUCTOR_SLUG = process.env.NEXT_PUBLIC_TEST_INSTRUCTOR_WAITLIST_SLUG || "test-instructor-waitlist";

const instructorSlugSchema = z.string().trim().nonempty();

export async function DELETE(request: Request) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const rawInstructorSlug = searchParams.get("instructor");

    const parseResult = instructorSlugSchema.safeParse(rawInstructorSlug);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Missing instructor parameter" },
        { status: 400 }
      );
    }

    const instructorSlug = parseResult.data;

    if (instructorSlug !== TEST_INSTRUCTOR_SLUG) {
      return NextResponse.json(
        { error: "Only test instructor cleanup is allowed" },
        { status: 403 }
      );
    }

    const convex = getConvexClient();
    const result = await convex.mutation(api.waitlist.removeByInstructorSlug, {
      instructorSlug,
    });

    return NextResponse.json({
      success: true,
      message: `Cleaned up waitlist entries for ${instructorSlug}`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("Waitlist cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
