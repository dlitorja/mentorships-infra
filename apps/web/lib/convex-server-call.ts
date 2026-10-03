/**
 * Server-to-server Convex HTTP call helper.
 *
 * Replaces the legacy pattern of calling Convex actions with a `secret`
 * arg authenticated by a shared secret in both environments. Each call
 * hits an `httpAction` in `convex/http.ts` that authenticates the bearer
 * against `CONVEX_HTTP_KEY`. (The shared-secret auth path was removed in
 * PRs #669–#675.)
 *
 * Why raw fetch instead of `ConvexHttpClient.action(...)`:
 *   - Bearer auth is not a feature of the SDK; raw fetch keeps the
 *     request shape transparent and easy to log / debug.
 *   - We don't need the SDK's reactive client features on the server.
 *
 * Env vars:
 *   - URL: prefers `CONVEX_URL` (Convex's server-only env for HTTP
 *     actions, typically the `.convex.site` host). Falls back to
 *     `NEXT_PUBLIC_CONVEX_URL` — which the rest of
 *     `apps/platform/lib/convex.ts` reads and which typically points
 *     at `.convex.cloud` (queries/mutations). When falling back, the
 *     `.convex.cloud` host is rewritten to `.convex.site` so HTTP
 *     actions are actually reachable.
 *   - Auth: `CONVEX_HTTP_KEY`.
 *
 * Caller responsibility:
 *   - Set the URL env var + `CONVEX_HTTP_KEY` in env.
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

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resolve the URL we POST server-to-server calls to. Convex exposes
 * queries/mutations on `<dep>.convex.cloud` and HTTP actions on
 * `<dep>.convex.site`. We always want the latter: if either env var
 * points at the `.convex.cloud` host we rewrite to `.convex.site`,
 * since this helper exclusively talks to HTTP actions. The rewrite is
 * a no-op when the value already targets `.convex.site`.
 */
function resolveConvexBaseUrl(): string {
  const explicit = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!explicit) return "";
  return explicit
    .replace(/\/+$/, "")
    .replace(/\.convex\.cloud$/, ".convex.site");
}

export async function convexServerCall<T>(
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const url = resolveConvexBaseUrl();
  if (!url) {
    throw new ConvexServerCallError(
      "CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set; cannot reach Convex",
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
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ConvexServerCallError(
        `Convex HTTP ${path} timed out after ${timeoutMs}ms`,
        504
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ConvexServerCallError(
      `Network error reaching Convex at ${path}: ${message}`,
      502
    );
  } finally {
    clearTimeout(timeoutId);
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
