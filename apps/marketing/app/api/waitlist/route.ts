import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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

/**
 * POST /api/waitlist
 * Proxy to web app waitlist API
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validated = waitlistPostSchema.parse(body);

    // Get web app URL from environment or use localhost for development
    const webAppUrl = process.env.WEB_APP_URL || "http://localhost:3001";

    // Proxy to web app API with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(`${webAppUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      console.error("Waitlist proxy: non-JSON response from web app");
      return NextResponse.json(
        { error: "Failed to join waitlist" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const validatedData = waitlistResponseSchema.parse(data);

    if (!response.ok) {
      return NextResponse.json(validatedData, { status: response.status });
    }

    return NextResponse.json(validatedData);
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
