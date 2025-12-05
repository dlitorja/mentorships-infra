import { NextResponse } from "next/server";

/**
 * Health check endpoint
 * Public route - no authentication required
 * 
 * GET /api/health
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "mentorship-platform",
  });
}

