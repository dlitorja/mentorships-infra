import type { Env } from "../lib/env";

export async function handleHealth(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path !== "/health" && path !== "/health/") {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(
    {
      status: "ok",
      service: "mentorships-edge-functions",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
