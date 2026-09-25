import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse, type NextRequest } from "next/server";
import { reportError } from "@/lib/observability";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const redisEnabled = Boolean(redisUrl && redisToken);

const redis = redisEnabled
  ? new Redis({
      url: redisUrl!,
      token: redisToken!,
    })
  : null;

export type RateLimitPolicy = "default" | "admin" | "webhook";

interface PolicyConfig {
  short: { limit: number; window: string };
  long?: { limit: number; window: string };
  identifyBy: "ip" | "userId";
}

const policies: Record<RateLimitPolicy, PolicyConfig> = {
  default: {
    short: { limit: 120, window: "60s" },
    identifyBy: "ip",
  },
  admin: {
    short: { limit: 60, window: "60s" },
    identifyBy: "userId",
  },
  webhook: {
    short: { limit: 10, window: "60s" },
    long: { limit: 100, window: "1h" },
    identifyBy: "ip",
  },
};

export function getIp(req: NextRequest): string {
  // Header priority — first non-empty wins:
  //   1. `x-vercel-forwarded-for`  Vercel-trusted (set by Vercel's edge;
  //      strips client-supplied values from upstream forwarded headers).
  //   2. `cf-connecting-ip`        Cloudflare-trusted (set by Cloudflare's
  //      edge when Vercel sits behind Cloudflare).
  //   3. `x-forwarded-for[0]`       Spoofable — only used as a fallback when
  //      no trusted edge is in front of the deployment.
  //   4. `x-real-ip`                Spoofable — fallback only.
  //   5. `"unknown"`                Final fallback when no header is set.
  //
  // Spoofable headers are intentionally LAST so a forged value cannot
  // mask the real IP for rate-limit identification or alerting.
  return (
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function createRatelimit(policy: RateLimitPolicy): Ratelimit | null {
  if (!redis) return null;

  const config = policies[policy];
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.short.limit, config.short.window as Duration),
    prefix: `ratelimit:${policy}:short`,
  });
}

export async function protectWithRateLimit(
  req: NextRequest,
  policy: RateLimitPolicy = "default",
  userId?: string | null
): Promise<NextResponse | null> {
  if (!redisEnabled || !redis) {
    void reportError({
      source: "ratelimit.middleware",
      error: new Error("Rate limiting disabled"),
      message: `Redis not configured: redisEnabled=${redisEnabled}, redis=${Boolean(redis)}`,
      context: { policy, pathname: req.nextUrl.pathname },
    });
    return null;
  }

  const config = policies[policy];
  const identifier =
    config.identifyBy === "userId" && userId
      ? userId
      : getIp(req);

  try {
    const ratelimit = createRatelimit(policy);
    if (!ratelimit) {
      return null;
    }

    const result = await ratelimit.limit(identifier);

    if (result.success) {
      return null;
    }

    // Emit an observability event for the rejected request so
    // operators can alert on sustained forgery bursts. Source is
    // `ratelimit.middleware` (constant) so it can be filtered
    // separately from the per-route error stream; `context.ip`
    // matches the `ip` field that handlers also emit on per-route
    // rejections, so a single monitor can pivot by IP across both.
    void reportError({
      source: "ratelimit.middleware",
      error: new Error("Rate limit exceeded"),
      message: `Rate limit exceeded for ${config.identifyBy} on ${req.nextUrl.pathname}`,
      level: "warn",
      context: {
        policy,
        pathname: req.nextUrl.pathname,
        method: req.method,
        identifier,
        // `identifier` is the rate-limit key (IP for unauthenticated
        // requests, Clerk userId for authenticated admin routes).
        // Operators investigating these alerts should see the
        // request's actual IP, not a userId masquerading as one.
        ip: getIp(req),
        identifyBy: config.identifyBy,
        limit: config.short.limit,
        window: config.short.window,
      },
    });

    return new NextResponse("Too many requests", {
      status: 429,
      headers: {
        "Retry-After": "60",
      },
    });
  } catch (error) {
    void reportError({
      source: "ratelimit.middleware",
      error,
      message: "Rate limit check failed (fail-open)",
      context: {
        policy,
        pathname: req.nextUrl.pathname,
        method: req.method,
        identifier: config.identifyBy === "userId" && userId ? "user" : "ip",
      },
    });
    return null;
  }
}
