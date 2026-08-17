const CORS_ALLOWED_ORIGINS: string[] = [];

/**
 * Configure allowed origins for CORS. Defaults to allowing the same origin
 * and the empty origin (for same-site requests). Add explicit origins in
 * production by setting ALLOWED_ORIGINS in the environment.
 */
export function getCorsOrigins(env: { ALLOWED_ORIGINS?: string }): string[] {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return CORS_ALLOWED_ORIGINS;
}

function getAllowedOrigin(request: Request, allowedOrigins: string[]): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (allowedOrigins.length === 0) return origin;
  if (allowedOrigins.includes(origin)) return origin;
  return null;
}

export function withCors(
  response: Response,
  request: Request,
  env: { ALLOWED_ORIGINS?: string }
): Response {
  const origin = getAllowedOrigin(request, getCorsOrigins(env));
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleCorsPreflight(request: Request, env: { ALLOWED_ORIGINS?: string }): Response | null {
  if (request.method !== "OPTIONS") return null;

  const origin = getAllowedOrigin(request, getCorsOrigins(env));
  const headers = new Headers();
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
}
