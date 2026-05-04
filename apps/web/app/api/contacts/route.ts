import { NextResponse } from "next/server";
import { validateEmail, sanitizeArtGoals } from "@/lib/validation";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { email, artGoals } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = validateEmail(email);
    if (!normalizedEmail) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const sanitizedArtGoals = sanitizeArtGoals(artGoals);

    const convex = getConvexClient();
    const result = await convex.mutation(api.contacts.addContact, {
      email: normalizedEmail,
      artGoals: sanitizedArtGoals || undefined,
      source: "matching_form",
      optedIn: true,
    });

    return NextResponse.json(
      { success: true, contact: result.contact },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    console.error("Failed to add email to contacts:", error);
    return NextResponse.json(
      { error: "Failed to add email to contacts" },
      { status: 500 }
    );
  }
}