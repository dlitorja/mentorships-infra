import { NextResponse } from "next/server";

/**
 * POST /api/contacts
 * Add email to contacts database for marketing/communications
 * Public endpoint - no authentication required
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, artGoals } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // TODO: Implement contacts database logic
    // 1. Validate email format
    // 2. Check if email already exists in contacts table
    // 3. Insert into contacts table with:
    //    - email
    //    - art_goals (optional, if provided)
    //    - source: "matching_form"
    //    - opted_in: true
    //    - created_at timestamp
    // 4. Send confirmation email (optional)
    
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
    console.error("Contacts error:", error);
    return NextResponse.json(
      { error: "Failed to add email to contacts" },
      { status: 500 }
    );
  }
}

