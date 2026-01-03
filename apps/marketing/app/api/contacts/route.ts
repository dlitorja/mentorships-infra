import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const contactsSchema = z.object({
  email: z.string().email(),
  artGoals: z.string().optional(),
});

/**
 * POST /api/contacts
 * Proxy to web app contacts API
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validated = contactsSchema.parse(body);

    // Get web app URL from environment or use localhost for development
    const webAppUrl = process.env.WEB_APP_URL || "http://localhost:3001";

    // Proxy to web app API with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(`${webAppUrl}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      console.error("Contacts proxy: non-JSON response from web app");
      return NextResponse.json(
        { error: "Failed to submit contact" },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request data" },
        { status: 400 }
      );
    }

    console.error("Contacts error:", error);
    return NextResponse.json(
      { error: "Failed to submit contact" },
      { status: 500 }
    );
  }
}
