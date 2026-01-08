import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { validateEmail } from "@/lib/validation";
import {
  VALID_GROUP_MENTORSHIP_SLUGS,
  waitlistPostSchema,
  waitlistGetSchema,
} from "@/lib/validators";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ytxtlscmxyqomxhripki.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

type WaitlistPostResponse =
  | { success: true; message: string }
  | { error: string; errorId: string };

type WaitlistGetResponse =
  | { onWaitlist: boolean; entries: unknown[] }
  | { error: string; errorId: string };

export async function POST(
  request: Request
): Promise<NextResponse<WaitlistPostResponse>> {
  const errorId = randomUUID();

  try {
    const { userId } = await auth();
    const body = await request.json();
    const validated = waitlistPostSchema.parse(body);
    const { instructorSlug, type, email } = validated;

    if (type === "group" && !VALID_GROUP_MENTORSHIP_SLUGS.includes(instructorSlug)) {
      return NextResponse.json(
        { error: "Group mentorship is not available for this instructor", errorId },
        { status: 400 }
      );
    }

    let userEmail: string;

    if (userId) {
      const user = await currentUser();
      const clerkEmail = user?.primaryEmailAddress?.emailAddress;
      if (!clerkEmail) {
        return NextResponse.json(
          { error: "User email not found", errorId },
          { status: 400 }
        );
      }
      userEmail = clerkEmail;
    } else {
      if (!email) {
        return NextResponse.json(
          { error: "Email is required for unauthenticated users", errorId },
          { status: 400 }
        );
      }
      const normalizedEmail = validateEmail(email);
      if (!normalizedEmail) {
        return NextResponse.json(
          { error: "Invalid email format", errorId },
          { status: 400 }
        );
      }
      userEmail = normalizedEmail;
    }

    const { data, error } = await supabase
      .from("marketing_waitlist")
      .select("*")
      .eq("email", userEmail)
      .eq("instructor_slug", instructorSlug)
      .eq("mentorship_type", type)
      .limit(1);

    if (error) {
      console.error("Error checking waitlist:", error);
      return NextResponse.json(
        { error: "Failed to join waitlist", errorId },
        { status: 500 }
      );
    }

    if (data && data.length > 0) {
      return NextResponse.json({
        success: true,
        message: "You are already on this waitlist",
      });
    }

    const { error: insertError } = await supabase
      .from("marketing_waitlist")
      .insert({
        email: userEmail,
        instructor_slug: instructorSlug,
        mentorship_type: type,
      });

    if (insertError) {
      console.error("Error inserting to waitlist:", insertError);
      return NextResponse.json(
        { error: "Failed to join waitlist", errorId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Successfully added to waitlist",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message || "Invalid request data",
          errorId,
        },
        { status: 400 }
      );
    }

    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Waitlist error [${errorId}]: ${errorName} - ${errorMessage}`);
    return NextResponse.json(
      { error: "Failed to join waitlist", errorId },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request
): Promise<NextResponse<WaitlistGetResponse>> {
  const errorId = randomUUID();

  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required", errorId },
        { status: 401 }
      );
    }

    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress;

    if (!userEmail) {
      return NextResponse.json(
        { error: "User email not found", errorId },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const instructorSlugParam = searchParams.get("instructorSlug");

    const validated = waitlistGetSchema.parse({
      instructorSlug: instructorSlugParam || undefined,
    });
    const { instructorSlug } = validated;

    let query = supabase
      .from("marketing_waitlist")
      .select("*")
      .eq("email", userEmail);

    if (instructorSlug) {
      query = query.eq("instructor_slug", instructorSlug);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching waitlist:", error);
      return NextResponse.json(
        { error: "Failed to query waitlist", errorId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      onWaitlist: (data?.length ?? 0) > 0,
      entries: data ?? [],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message || "Invalid query parameters",
          errorId,
        },
        { status: 400 }
      );
    }

    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Waitlist query error [${errorId}]: ${errorName} - ${errorMessage}`
    );
    return NextResponse.json(
      { error: "Failed to query waitlist", errorId },
      { status: 500 }
    );
  }
}
