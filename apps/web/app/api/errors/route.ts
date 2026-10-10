import { NextRequest, NextResponse, after } from "next/server";
import { reportError } from "@/lib/observability";

/**
 * POST /api/errors
 * Forward client-side errors to Axiom for error tracking
 * Server-side endpoint to avoid exposing Axiom tokens to clients
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    // Greptile R5 P2: schedule the Axiom write via Next's `after()`
    // so Vercel keeps the in-flight Promise alive until it resolves
    // instead of killing it the moment the response is flushed.
    // Without this, client errors sent near the end of a function
    // invocation can be lost entirely. `reportError` already
    // catches internally so this never throws out of the after().
    after(() => {
      void reportError({
        source: "client.errors",
        // Client payloads are not guaranteed to be Error instances; treat them as unknown.
        error: body,
        message: "Client-side error report",
        level: "error",
        context: {
          pathname: request.nextUrl.pathname,
          userAgent: request.headers.get("user-agent"),
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Don't expose error details to client
    console.error("Error tracking failed:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

