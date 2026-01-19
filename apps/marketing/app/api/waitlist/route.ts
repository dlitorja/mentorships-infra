import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const waitlistPostSchema = z.object({
  email: z.string().email(),
  instructorSlug: z.string().min(1),
  type: z.enum(["one-on-one", "group"]),
});

const waitlistResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Supabase configuration missing" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await request.json();
    const validated = waitlistPostSchema.parse(body);

    const { error } = await supabaseAdmin
      .from("marketing_waitlist")
      .insert({
        email: validated.email,
        instructor_slug: validated.instructorSlug,
        mentorship_type: validated.type,
      });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({
          success: true,
          message: "You are already on this waitlist",
        });
      }
      console.error("Waitlist error:", error);
      return NextResponse.json(
        { error: "Failed to join waitlist" },
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
        { error: error.issues[0]?.message || "Invalid request data" },
        { status: 400 }
      );
    }

    console.error("Waitlist error:", error);
    return NextResponse.json(
      { error: "Failed to join waitlist" },
      { status: 500 }
    );
  }
}
