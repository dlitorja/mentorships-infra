import { NextResponse } from "next/server";
import { validateEmail, sanitizeArtGoals } from "@/lib/validation";
import {
  createApiSuccess,
  validationError,
  internalError
} from "@/lib/api-error";
import { db } from "@/lib/db";
import { contacts } from "@mentorships/db";
import { eq } from "drizzle-orm";

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

    // Check if email already exists
    const existingContact = await db
      .select()
      .from(contacts)
      .where(eq(contacts.email, normalizedEmail))
      .limit(1);

    // If contact exists, return early with the stored contact
    if (existingContact.length > 0) {
      return NextResponse.json({ success: true, contact: existingContact[0] }, { status: 200 });
    }

    // Insert new contact
    await db.insert(contacts).values({
      email: normalizedEmail,
      artGoals: sanitizedArtGoals || null,
      source: "matching_form",
      optedIn: true,
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    const { response: errorResponse } = internalError("Failed to add email to contacts");
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

