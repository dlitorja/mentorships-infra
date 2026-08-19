import { getClientIp, isTurnstileTokenValid } from "@mentorships/security";
import type { Env } from "../lib/env";
import { callConvexMutation, callConvexQuery } from "../lib/convex";
import { getDownloadUrlWithContentDisposition } from "../lib/b2";
import { logError } from "../lib/observability";
import {
  deleteCachedShare,
  deleteCachedShareForToken,
  getCachedShare,
  isShareRevokedCache,
  markShareRevokedCache,
  setCachedShare,
  type CachedShare,
} from "../lib/kv";

interface ResolveShareResult {
  kind: string;
  share?: {
    id: string;
    createdByUserId?: string;
    createdAt?: number;
    expiresAt?: number | null;
    label?: string | null;
  };
  upload?: {
    id?: string;
    filename: string;
    originalName: string;
    contentType?: string;
    size?: number;
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

  // Always re-check the global revocation marker before using any cached data.
  const revoked = await isShareRevokedCache(env, token);
  if (revoked) {
    if (convexToken) {
      await deleteCachedShareForToken(env, token, convexToken);
    } else {
      await deleteCachedShare(env, token);
    }
    return json({ error: "Share revoked" }, 410);
  }

  const cachedResult = convexToken
    ? await getCachedShare(env, token, convexToken)
    : null;

  let upload: { filename: string; originalName: string } | null = null;
  let shareId: string | undefined;

  if (cachedResult) {
    upload = cachedResult.upload;
    shareId = cachedResult.shareId;
  } else {
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
      await deleteCachedShare(env, token);
      return json({ error: "Share or file not found" }, 404);
    }
    if (result.kind === "revoked") {
      await markShareRevokedCache(env, token);
      await deleteCachedShare(env, token);
      return json({ error: "Share revoked" }, 410);
    }
    if (result.kind === "expired") {
      if (convexToken) {
        await deleteCachedShareForToken(env, token, convexToken);
      } else {
        await deleteCachedShare(env, token);
      }
      return json({ error: "Share expired" }, 410);
    }

    if (!result.upload || !result.upload.filename) {
      return json({ error: "File location unknown" }, 400);
    }

    upload = result.upload;
    shareId = result.share?.id;

    const cacheEntry: CachedShare = {
      shareId: result.share?.id ?? "",
      createdByUserId: result.share?.createdByUserId ?? "",
      createdAt: result.share?.createdAt ?? Date.now(),
      expiresAt: result.share?.expiresAt ?? null,
      label: result.share?.label ?? null,
      upload: {
        id: result.upload.id ?? "",
        filename: result.upload.filename,
        originalName: result.upload.originalName,
        contentType: result.upload.contentType ?? "application/octet-stream",
        size: result.upload.size ?? 0,
      },
    };
    await setCachedShare(env, token, convexToken, cacheEntry);
  }

  const userAgent = request.headers.get("user-agent") ?? undefined;

  try {
    const logResult = await callConvexMutation<LogShareAccessResult>(
      env,
      "hdShareLinks:logShareAccess",
      {
        shareId,
        action: "download",
        ip,
        userAgent,
      },
      convexToken
    );

    if (!logResult.ok) {
      logError(source, new Error(logResult.message), "Failed to log share download", {
        shareId,
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
