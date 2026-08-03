import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import crypto from "node:crypto";
import { reportInfo } from "@/lib/observability";

// Origins allowed as a fallback when NEXT_PUBLIC_URL is not set outside
// production. Only exact host matches are accepted; anything else falls back
// to localhost so an arbitrary request Origin cannot redirect a user.
const ALLOWED_FALLBACK_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/**
 * Resolves the base URL for redirects.
 *
 * - Actual production (NODE_ENV === "production" and Vercel env === "production")
 *   requires NEXT_PUBLIC_URL to be configured.
 * - Vercel preview deployments, local development, and any other environment
 *   use NEXT_PUBLIC_URL if set.
 * - Otherwise, the request Origin is validated against an allowlist before it
 *   is used; any unapproved origin falls back to http://localhost:3000.
 */
function getBaseUrl(request: NextRequest): string {
  const configuredUrl = process.env.NEXT_PUBLIC_URL;
  const vercelEnv = process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV;
  const isVercelProduction = vercelEnv === "production";

  // Only the live production deployment is required to have an explicit URL.
  // Preview deployments and local builds are allowed to fall back to the
  // request origin so Stripe redirects still work without a production env var.
  if (process.env.NODE_ENV === "production" && isVercelProduction) {
    if (!configuredUrl) {
      throw new Error("NEXT_PUBLIC_URL must be configured in production");
    }
    return configuredUrl;
  }

  if (configuredUrl) {
    return configuredUrl;
  }

  const origin = request.headers.get("origin") || "http://localhost:3000";
  try {
    const originHost = new URL(origin).host;
    const isAllowed = ALLOWED_FALLBACK_ORIGINS.some((allowed) => {
      try {
        return new URL(allowed).host === originHost;
      } catch {
        return allowed === originHost;
      }
    });
    return isAllowed ? origin : "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * GET /api/checkout/cancel
 * Handle canceled checkout redirect from Stripe
 *
 * Query params:
 * - order_id: Order ID to cancel
 *
 * Redirects to cancel page
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const orderId = searchParams.get("order_id");
  const ts = searchParams.get("ts");
  const token = searchParams.get("token");
  const baseUrl = getBaseUrl(request);

  try {
    // Public cancel: proceed without authentication

    if (orderId) {
      // Update order status to canceled only if it's still pending
      try {
        const convex = getConvexClient();
        const order = await convex.query(api.orders.getOrderByIdPublic, { id: orderId as Id<"orders"> });
        // Require a valid signed cancel token and a recent timestamp (48h)
        const secret = process.env.CANCEL_TOKEN_SECRET;
        const withinWindow = ts ? Date.now() - Number(ts) < 48 * 3600 * 1000 : false;
        const expected = secret && ts ? crypto.createHmac("sha256", secret).update(`${orderId}:${ts}`).digest("hex") : null;
        const tokenValid = Boolean(expected && token && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token)));

        if (order && order.status === "pending" && tokenValid && withinWindow) {
          await convex.mutation(api.orders.cancelOrder, { id: orderId as Id<"orders"> });
        } else if (order && order.status === "pending") {
          // Structured audit log on invalid attempts
          const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined;
          const ua = request.headers.get("user-agent") || undefined;
          await reportInfo({
            source: "api/checkout/cancel",
            message: "Invalid cancel token attempt",
            level: "warn",
            context: {
              orderId,
              ts: ts || null,
              withinWindow,
              tokenPrefix: token ? token.slice(0, 8) : null,
              ip: ip || null,
              userAgent: ua || null,
            },
          });
        }
      } catch (error) {
        // Log error but don't fail - order might already be processed
        console.error("Error canceling order:", error);
      }
    }

    // Use NextResponse.redirect to avoid redirect being caught by try/catch
    return NextResponse.redirect(
      new URL(
        `/checkout/cancel${orderId ? `?order_id=${encodeURIComponent(orderId)}` : ""}`,
        baseUrl
      )
    );
  } catch (error) {
    console.error("Checkout cancel handler error:", error);

    return NextResponse.redirect(new URL("/checkout/cancel", baseUrl));
  }
}
