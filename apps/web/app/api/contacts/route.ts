import { NextResponse } from "next/server";
import { validateEmail, sanitizeArtGoals } from "@/lib/validation";
import { 
  createApiSuccess, 
  validationError, 
  internalError 
} from "@/lib/api-error";

/**
 * POST /api/contacts
 * Add email to contacts database for marketing/communications
 * Public endpoint - no authentication required
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { email, artGoals } = body;

    if (!email) {
      const { response: errorResponse } = validationError("Email is required");
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate and normalize email
    const normalizedEmail = validateEmail(email);
    if (!normalizedEmail) {
      const { response: errorResponse } = validationError("Invalid email format");
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Sanitize artGoals
    const sanitizedArtGoals = sanitizeArtGoals(artGoals);

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

    return NextResponse.json(
      createApiSuccess(
        { email: normalizedEmail, artGoals: sanitizedArtGoals },
        "Email added to contacts"
      )
    );
  } catch {
    const { response: errorResponse } = internalError("Failed to add email to contacts");
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

