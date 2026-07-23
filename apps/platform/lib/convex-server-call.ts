/**
 * Server-to-server Convex HTTP call helper.
 *
 * Replaces the legacy pattern of calling Convex actions with a `secret`
 * arg authenticated by `CONVEX_SERVER_SHARED_SECRET`. Each call hits
 * an `httpAction` in `convex/http.ts` that authenticates the bearer
 * against `CONVEX_HTTP_KEY`.
 *
 * Why raw fetch instead of `ConvexHttpClient.action(...)`:
 *   - Bearer auth is not a feature of the SDK; raw fetch keeps the
 *     request shape transparent and easy to log / debug.
 *   - We don't need the SDK's reactive client features on the server.
 *
 * Caller responsibility:
 *   - Set `CONVEX_URL` and `CONVEX_HTTP_KEY` in env.
 *   - Decide retry policy for 5xx (this helper does not retry).
 *   - Pass an args shape that matches the httpAction's expected body.
 *
 * The bearer value is never logged, echoed, or included in thrown
 * error messages. See AGENTS.md "Secret Protection Policy".
 */
export class ConvexServerCallError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ConvexServerCallError";
    this.status = status;
  }
}

export async function convexServerCall<T>(
  path: string,
  body: unknown
): Promise<T> {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new ConvexServerCallError(
      "CONVEX_URL is not set; cannot reach Convex",
      500
    );
  }

  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new ConvexServerCallError(
      "CONVEX_HTTP_KEY is not set; cannot authenticate against Convex",
      500
    );
  }

  if (!path.startsWith("/")) {
    throw new ConvexServerCallError(
      `Convex HTTP path must start with "/"; got "${path}"`,
      500
    );
  }

  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConvexServerCallError(
      `Network error reaching Convex at ${path}: ${message}`,
      502
    );
  }

  if (response.status === 401) {
    throw new ConvexServerCallError(
      `Convex rejected authentication for ${path} (401). Check CONVEX_HTTP_KEY.`,
      502
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const safeText = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    throw new ConvexServerCallError(
      `Convex HTTP ${response.status} at ${path}: ${safeText}`,
      502
    );
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConvexServerCallError(
      `Convex HTTP ${path} returned non-JSON body: ${message}`,
      502
    );
  }
}
