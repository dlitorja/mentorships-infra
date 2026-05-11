import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/observability";

/**
 * POST /api/errors
 * Forward client-side errors to Better Stack for error tracking
 * Server-side endpoint to avoid exposing Better Stack tokens to clients
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    // Only forward to Better Stack if token is configured
    if (process.env.BETTERSTACK_SOURCE_TOKEN) {
      await fetch("https://in.logs.betterstack.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.BETTERSTACK_SOURCE_TOKEN}`,
        },
        body: JSON.stringify({
          ...body,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {
        // Silently fail if Better Stack is unavailable
      });
    }

    // Also forward to Axiom (if configured) for querying/correlation.
    // Best-effort, never blocks the response.
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

    return NextResponse.json({ success: true });
  } catch (error) {
    // Don't expose error details to client
    console.error("Error tracking failed:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

