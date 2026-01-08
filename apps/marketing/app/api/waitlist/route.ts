import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

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
    const body = await request.json();
    const validated = waitlistPostSchema.parse(body);

    const { data, error } = await supabase
      .from("marketing_waitlist")
      .insert({
        email: validated.email,
        instructor_slug: validated.instructorSlug,
        mentorship_type: validated.type,
      })
      .select()
      .single();

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
