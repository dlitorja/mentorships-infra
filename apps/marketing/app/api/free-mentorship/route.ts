import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { freeMentorshipFormSchema } from "@mentorships/schemas";
import { rateLimit } from "@/lib/utils";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const antiSpamSchema = z.object({
  honeypot: z.string().optional(),
  formTimestamp: z.number().optional(),
});

async function updateConsent(
  email: string,
  instructorSlug: string
): Promise<Error | null> {
  const { error } = await supabase.rpc("update_consent", {
    p_email: email,
    p_instructor_slug: instructorSlug,
    p_consent: true,
  });
  return error;
}

type FreeMentorshipPostResponse =
  | { success: true; message: string }
  | { error: string; errorId: string };

export async function POST(
  request: Request
): Promise<NextResponse<FreeMentorshipPostResponse>> {
  const errorId = randomUUID();

  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? 
               request.headers.get("cf-connecting-ip") ?? 
               null;
    if (!ip) {
      console.error(`[free-mentorship] Rejected request: no IP header present (errorId: ${errorId})`);
      return NextResponse.json(
        { error: "Unable to process request", errorId },
        { status: 400 }
      );
    }
    const rateLimitResult = await rateLimit(`free-mentorship:${ip}`, 3, 60000);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", errorId },
        { status: 429 }
      );
    }

    const body = await request.json();
    const validated = freeMentorshipFormSchema.parse(body);
    const { name, email, portfolioUrl, timeZone, artGoals, instructorSlug, consent } = validated;

    const antiSpam = antiSpamSchema.parse(body);

    if (antiSpam.honeypot) {
      console.log("Honeypot triggered, rejecting submission");
      return NextResponse.json({
        success: true,
        message: "Successfully signed up for free mentorship",
      });
    }

    if (!antiSpam.formTimestamp || (Date.now() - antiSpam.formTimestamp) < 3000) {
      console.log("Form submitted too quickly or missing timestamp, rejecting");
      return NextResponse.json(
        { error: "Form submission too fast. Please try again.", errorId },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { data: existing, error: checkError } = await supabase
      .from("free_mentorship_signups")
      .select("id, created_at")
      .eq("email", normalizedEmail)
      .eq("instructor_slug", instructorSlug)
      .limit(1);

    if (checkError) {
      console.error("Error checking existing signup:", checkError);
      return NextResponse.json(
        { error: "Failed to submit signup", errorId },
        { status: 500 }
      );
    }

    if (existing && existing.length > 0) {
      if (consent === true) {
        const consentError = await updateConsent(normalizedEmail, instructorSlug);
        if (consentError) {
          console.error("Error updating consent:", consentError);
          return NextResponse.json(
            { error: "Failed to submit signup", errorId },
            { status: 500 }
          );
        }
      }
      return NextResponse.json({
        success: true,
        message: "You're already signed up for this instructor's free mentorship!",
      });
    }

    const { error: insertError } = await supabase
      .from("free_mentorship_signups")
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        portfolio_url: portfolioUrl?.trim() || null,
        time_zone: timeZone,
        art_goals: artGoals.trim(),
        instructor_slug: instructorSlug,
        consent: consent === true,
        consent_timestamp: consent === true ? new Date().toISOString() : null,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        if (consent === true) {
          const consentError = await updateConsent(normalizedEmail, instructorSlug);
          if (consentError) {
            console.error("Error updating consent:", consentError);
            return NextResponse.json(
              { error: "Failed to submit signup", errorId },
              { status: 500 }
            );
          }
        }
        return NextResponse.json({
          success: true,
          message: "You're already signed up for this instructor's free mentorship!",
        });
      }
      console.error("Error inserting free mentorship signup:", insertError);
      return NextResponse.json(
        { error: "Failed to submit signup", errorId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Successfully signed up for free mentorship",
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
    console.error(`Free mentorship error [${errorId}]: ${errorName} - ${errorMessage}`);
    return NextResponse.json(
      { error: "Failed to submit signup", errorId },
      { status: 500 }
    );
  }
}
