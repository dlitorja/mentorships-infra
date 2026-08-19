import type { Env } from "./lib/env";
import { handleCorsPreflight, withCors } from "./lib/cors";
import { handleHealth } from "./routes/health";
import { handleCacheInvalidation } from "./routes/internal";
import { handleShareRevoke } from "./routes/revoke";
import { handleDailyWebhook } from "./routes/webhooks/daily";
import { handlePayPalWebhook } from "./routes/webhooks/paypal";
import { handleStripeWebhook } from "./routes/webhooks/stripe";
import { handleSharedDownload } from "./routes/shared";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const corsPreflight = handleCorsPreflight(request, env);
    if (corsPreflight) return corsPreflight;

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      let response: Response;

      if (path === "/health" || path === "/health/") {
        response = await handleHealth(request, env);
      } else if (path === "/webhooks/stripe" && request.method === "POST") {
        response = await handleStripeWebhook(request, env);
      } else if (path === "/webhooks/paypal" && request.method === "POST") {
        response = await handlePayPalWebhook(request, env);
      } else if (path === "/webhooks/daily" && request.method === "POST") {
        response = await handleDailyWebhook(request, env);
      } else {
        const sharedMatch = path.match(/^\/shared\/([^/]+)\/?$/);
        if (sharedMatch && sharedMatch[1] && request.method === "POST") {
          response = await handleSharedDownload(request, env, sharedMatch[1]);
        } else if (path === "/internal/cache/invalidate" && request.method === "POST") {
          response = await handleCacheInvalidation(request, env);
        } else {
          const revokeMatch = path.match(/^\/internal\/shares\/([^/]+)\/revoke\/?$/);
          if (revokeMatch && revokeMatch[1] && request.method === "POST") {
            response = await handleShareRevoke(request, env, revokeMatch[1]);
          } else {
            response = new Response("Not found", { status: 404 });
          }
        }
      }

      return withCors(response, request, env);
    } catch (error) {
      console.error("Edge function error:", error);
      return withCors(
        new Response(
          JSON.stringify({ error: "Internal server error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        ),
        request,
        env
      );
    }
  },
};
