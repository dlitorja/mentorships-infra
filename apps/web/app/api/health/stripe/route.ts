import { NextResponse } from "next/server";
import { createApiSuccess, createApiError, externalServiceError } from "@/lib/api-error";
import { stripe } from "@/lib/stripe";

/**
 * GET /api/health/stripe
 * Stripe service health check
 * Verifies Stripe API connectivity and configuration
 */
export async function GET() {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      const { response: errorResponse } = createApiError(
        "EXTERNAL_SERVICE_ERROR",
        "Stripe configuration missing",
        503
      );
      return NextResponse.json(errorResponse, { status: 503 });
    }

    const startTime = Date.now();
    
    // Test Stripe API with a simple account retrieval
    await stripe.accounts.list({ limit: 1 });
    
    const responseTime = Date.now() - startTime;

    const status = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      stripe: {
        connected: true,
        responseTime,
        mode: process.env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'live' : 'test',
      },
    };

    return NextResponse.json(createApiSuccess(status, "Stripe service is healthy"));
  } catch {
    const { response: errorResponse } = externalServiceError(
      "Stripe", 
      "API connection failed"
    );
    return NextResponse.json(errorResponse, { status: 503 });
  }
}