import { NextResponse } from "next/server";
import { createApiSuccess, createApiError } from "@/lib/api-error";

/**
 * GET /api/health
 * Basic health check endpoint
 * Returns overall system status without sensitive information
 */
export async function GET() {
  try {
    const status = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV,
    };

    return NextResponse.json(createApiSuccess(status, "System is healthy"));
  } catch {
    const { response: errorResponse } = createApiError("INTERNAL_ERROR", "Health check failed", 503);
    return NextResponse.json(errorResponse, { status: 503 });
  }
}

