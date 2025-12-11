import { NextResponse } from "next/server";
import { validateEmail, sanitizeArtGoals } from "@/lib/validation";
import { randomUUID } from "crypto";

/**
 * POST /api/contacts
 * Add email to contacts database for marketing/communications
 * Public endpoint - no authentication required
 */
export async function POST(request: Request): Promise<NextResponse> {
  const errorId = randomUUID();

  try {
    const body = await request.json();
    const { email, artGoals } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required", errorId },
        { status: 400 }
      );
    }

    // Validate and normalize email
    const normalizedEmail = validateEmail(email);
    if (!normalizedEmail) {
      return NextResponse.json(
        { error: "Invalid email format", errorId },
        { status: 400 }
      );
    }

    // Sanitize artGoals
    const _sanitizedArtGoals = sanitizeArtGoals(artGoals);

    // TODO: Implement contacts database logic
    // 1. Check if email already exists in contacts table
    // 2. Insert into contacts table with:
    //    - email: normalizedEmail
    //    - art_goals: sanitizedArtGoals (optional, if provided)
    //    - source: "matching_form"
    //    - opted_in: true
    //    - created_at timestamp
    // 3. Send confirmation email (optional)
    
    // For now, just return success
    // In production, this would:
    // - Insert into contacts/marketing database
    // - Add to email marketing platform (e.g., Mailchimp, SendGrid)
    // - Send welcome email

    return NextResponse.json({
      success: true,
      message: "Email added to contacts",
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Contacts error [${errorId}]: ${errorName} - ${errorMessage}`);
    return NextResponse.json(
      { error: "Failed to add email to contacts", errorId },
      { status: 500 }
    );
  }
}

