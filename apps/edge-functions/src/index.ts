import type { Env } from "./lib/env";
import { handleHealth } from "./routes/health";
import { handleDailyWebhook } from "./routes/webhooks/daily";
import { handlePayPalWebhook } from "./routes/webhooks/paypal";
import { handleStripeWebhook } from "./routes/webhooks/stripe";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/health" || path === "/health/") {
        return await handleHealth(request, env);
      }

      if (path === "/webhooks/stripe" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }

      if (path === "/webhooks/paypal" && request.method === "POST") {
        return await handlePayPalWebhook(request, env);
      }

      if (path === "/webhooks/daily" && request.method === "POST") {
        return await handleDailyWebhook(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error("Edge function error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
