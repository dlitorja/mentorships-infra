import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const waitlistPostSchema = z.object({
  email: z.string().email(),
  instructorSlug: z.string().min(1),
  type: z.enum(["one-on-one", "group"]),
});

/**
 * POST /api/waitlist
 * Proxy to web app waitlist API
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validated = waitlistPostSchema.parse(body);

    // Get web app URL from environment or use localhost for development
    const webAppUrl = process.env.NEXT_PUBLIC_WEB_APP_URL || "http://localhost:3001";

    // Proxy to web app API
    const response = await fetch(`${webAppUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated),
    });

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

    console.error("Waitlist error:", error);
    return NextResponse.json(
      { error: "Failed to join waitlist" },
      { status: 500 }
    );
  }
}
