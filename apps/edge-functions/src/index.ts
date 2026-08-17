import type { Env } from "./lib/env";
import { handleHealth } from "./routes/health";

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
