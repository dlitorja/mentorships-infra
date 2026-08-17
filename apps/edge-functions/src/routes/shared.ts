import { getClientIp, isTurnstileTokenValid } from "@mentorships/security";
import type { Env } from "../lib/env";
import { callConvexMutation, callConvexQuery } from "../lib/convex";
import { getDownloadUrlWithContentDisposition } from "../lib/b2";
import { logError } from "../lib/observability";

interface ResolveShareResult {
  kind: string;
  share?: {
    id: string;
  };
  upload?: {
    filename: string;
    originalName: string;
  };
}

interface LogShareAccessResult {
  success: boolean;
}

/**
 * POST /shared/:token
 * Worker-side port of apps/huckleberry-drive/src/app/api/shared/[token]/route.ts.
 * Verifies a Turnstile token, resolves the share via Convex, logs access, and
 * returns a signed B2 download URL.
 */
export async function handleSharedDownload(
  request: Request,
  env: Env,
  token: string
): Promise<Response> {
  const source = "shared/download";

  if (!token || token.length < 16) {
    return json({ error: "Invalid token" }, 400);
  }

  let body: { turnstileToken?: unknown; convexToken?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  if (!turnstileToken) {
    return json({ error: "Turnstile token is required" }, 401);
  }

  const ip = getClientIp(request);
  const isValid = await isTurnstileTokenValid(turnstileToken, {
    secretKey: env.TURNSTILE_SECRET_KEY,
    remoteIp: ip,
    action: "share-download",
  });
  if (!isValid) {
    return json({ error: "Turnstile verification failed" }, 401);
  }

  const convexToken = typeof body.convexToken === "string" ? body.convexToken : undefined;

  const resolveResult = await callConvexQuery<ResolveShareResult>(
    env,
    "hdShareLinks:resolveShareByToken",
    { token },
    convexToken
  );

  if (!resolveResult.ok) {
    logError(source, new Error(resolveResult.message), "Failed to resolve share");
    return json({ error: "Internal server error" }, 500);
  }

  const result = resolveResult.value;

  if (result.kind === "unauthenticated") {
    return json({ error: "Unauthorized" }, 401);
  }
  if (result.kind === "forbidden") {
    return json({ error: "Forbidden" }, 403);
  }
  if (result.kind === "not_found" || result.kind === "file_missing") {
    return json({ error: "Share or file not found" }, 404);
  }
  if (result.kind === "revoked") {
    return json({ error: "Share revoked" }, 410);
  }
  if (result.kind === "expired") {
    return json({ error: "Share expired" }, 410);
  }

  const upload = result.upload;
  if (!upload || !upload.filename) {
    return json({ error: "File location unknown" }, 400);
  }

  const userAgent = request.headers.get("user-agent") ?? undefined;

  try {
    const logResult = await callConvexMutation<LogShareAccessResult>(
      env,
      "hdShareLinks:logShareAccess",
      {
        shareId: result.share?.id,
        action: "download",
        ip,
        userAgent,
      },
      convexToken
    );

    if (!logResult.ok) {
      logError(source, new Error(logResult.message), "Failed to log share download", {
        shareId: result.share?.id,
      });
    }
  } catch (loggingError) {
    logError(source, loggingError, "Failed to log share download");
  }

  const downloadUrl = await getDownloadUrlWithContentDisposition(
    env,
    upload.filename,
    upload.originalName,
    3600
  );

  return json({ downloadUrl });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
