import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_INSTRUCTOR_SLUG = process.env.TEST_INSTRUCTOR_WAITLIST_SLUG || "test-instructor-waitlist";

export async function DELETE(request: Request) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing" },
      { status: 500 }
    );
  }

  try {
    await requireAdmin();

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { searchParams } = new URL(request.url);
    const instructorSlug = searchParams.get("instructor");

    if (!instructorSlug) {
      return NextResponse.json(
        { error: "Missing instructor parameter" },
        { status: 400 }
      );
    }

    if (instructorSlug !== TEST_INSTRUCTOR_SLUG) {
      return NextResponse.json(
        { error: "Only test instructor cleanup is allowed" },
        { status: 403 }
      );
    }

    const { error } = await supabaseAdmin
      .from("marketing_waitlist")
      .delete()
      .eq("instructor_slug", instructorSlug);

    if (error) {
      console.error("Error cleaning up waitlist:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Cleaned up waitlist entries for ${instructorSlug}`,
    });
  } catch (error) {
    console.error("Waitlist cleanup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
