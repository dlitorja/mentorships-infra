import type { Env } from "./env";

export interface ConvexActionResult<T> {
  ok: true;
  value: T;
}

export interface ConvexActionError {
  ok: false;
  message: string;
  errorData?: unknown;
}

export type ConvexActionResponse<T> = ConvexActionResult<T> | ConvexActionError;

export async function callConvexFunction<T>(
  env: Env,
  endpoint: "query" | "mutation" | "action",
  path: string,
  args: Record<string, unknown>,
  authToken?: string
): Promise<ConvexActionResponse<T>> {
  const convexUrl = env.CONVEX_URL;
  if (!convexUrl) {
    return { ok: false, message: "CONVEX_URL is not configured" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${convexUrl.replace(/\/+$/, "")}/api/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      path,
      format: "json",
      args,
    }),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: `Convex returned non-JSON response: ${response.status} ${text}`,
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.status === "success") {
    return { ok: true, value: obj.value as T };
  }
  if (obj.status === "error") {
    return {
      ok: false,
      message: typeof obj.errorMessage === "string" ? obj.errorMessage : "Convex function failed",
      errorData: obj.errorData,
    };
  }

  return {
    ok: false,
    message: `Unexpected Convex response: ${JSON.stringify(obj)}`,
  };
}

export async function callConvexQuery<T>(
  env: Env,
  path: string,
  args: Record<string, unknown>,
  authToken?: string
): Promise<ConvexActionResponse<T>> {
  return callConvexFunction<T>(env, "query", path, args, authToken);
}

export async function callConvexMutation<T>(
  env: Env,
  path: string,
  args: Record<string, unknown>,
  authToken?: string
): Promise<ConvexActionResponse<T>> {
  return callConvexFunction<T>(env, "mutation", path, args, authToken);
}
