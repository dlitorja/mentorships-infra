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

export type RateLimitPolicy =
  | "default"
  | "auth"
  | "booking"
  | "checkout"
  | "availability"
  | "instructor"
  | "forms"
  | "webhook"
  | "user";

interface PolicyConfig {
  short: { limit: number; window: string };
  long: { limit: number; window: string };
  identifyBy: "ip" | "userId";
}

const policies: Record<RateLimitPolicy, PolicyConfig> = {
  default: {
    short: { limit: 120, window: "60s" },
    long: { limit: 2000, window: "1h" },
    identifyBy: "ip",
  },
  auth: {
    short: { limit: 15, window: "60s" },
    long: { limit: 60, window: "1h" },
    identifyBy: "ip",
  },
  checkout: {
    short: { limit: 3, window: "60s" },
    long: { limit: 10, window: "1h" },
    identifyBy: "userId",
  },
  booking: {
    short: { limit: 5, window: "60s" },
    long: { limit: 20, window: "1h" },
    identifyBy: "userId",
  },
  availability: {
    short: { limit: 30, window: "60s" },
    long: { limit: 200, window: "1h" },
    identifyBy: "userId",
  },
  instructor: {
    short: { limit: 10, window: "60s" },
    long: { limit: 60, window: "1h" },
    identifyBy: "userId",
  },
  forms: {
    short: { limit: 3, window: "60s" },
    long: { limit: 10, window: "1h" },
    identifyBy: "ip",
  },
  webhook: {
    short: { limit: 100, window: "60s" },
    long: { limit: 1000, window: "1h" },
    identifyBy: "ip",
  },
  user: {
    short: { limit: 120, window: "60s" },
    long: { limit: 6000, window: "1h" },
    identifyBy: "userId",
  },
};

function getIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function parseWindowToSeconds(window: string): number {
  const match = window.match(/^(\d+)(s|m|h)$/);
  if (!match) return 60;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    default:
      return 60;
  }
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

function createLongTermRatelimit(policy: RateLimitPolicy): Ratelimit | null {
  if (!redis) return null;

  const config = policies[policy];
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.long.limit, config.long.window as Duration),
    prefix: `ratelimit:${policy}:long`,
  });
}

export async function protectWithRateLimit(
  req: NextRequest,
  args: {
    policy: RateLimitPolicy;
    userId?: string | null;
    requested?: number;
  }
): Promise<NextResponse | null> {
  const requested = args.requested ?? 1;
  const policy = args.policy;
  const config = policies[policy];

  if (!redisEnabled || !redis) {
    void reportError({
      source: "ratelimit.middleware",
      error: new Error("Rate limiting disabled"),
      message: `Redis not configured: redisEnabled=${redisEnabled}, redis=${Boolean(redis)}`,
      context: { policy, pathname: req.nextUrl.pathname },
    });
    return null;
  }

  const identifier =
    config.identifyBy === "userId" && args.userId
      ? args.userId
      : getIp(req);

  try {
    const shortLimit = createRatelimit(policy);
    const longLimit = createLongTermRatelimit(policy);

    if (!shortLimit || !longLimit) {
      return null;
    }

    const shortResult = await shortLimit.limit(identifier, { rate: requested });

    if (!shortResult.success) {
      const retryAfterShort = shortResult.reset
        ? Math.ceil((shortResult.reset - Date.now()) / 1000)
        : parseWindowToSeconds(config.short.window);
      return NextResponse.json(
        { error: "Too Many Requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, retryAfterShort)),
            "X-RateLimit-Limit-Short": String(config.short.limit),
            "X-RateLimit-Remaining-Short": String(shortResult.remaining),
          },
        }
      );
    }

    const longResult = await longLimit.limit(identifier, { rate: requested });

    if (!longResult.success) {
      const retryAfterLong = longResult.reset
        ? Math.ceil((longResult.reset - Date.now()) / 1000)
        : parseWindowToSeconds(config.long.window);
      return NextResponse.json(
        { error: "Too Many Requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, retryAfterLong)),
            "X-RateLimit-Limit-Long": String(config.long.limit),
            "X-RateLimit-Remaining-Long": String(longResult.remaining),
          },
        }
      );
    }

    return null;
  } catch (error) {
    void reportError({
      source: "ratelimit.middleware",
      error,
      message: "Rate limit check failed (fail-open)",
      context: {
        policy,
        pathname: req.nextUrl.pathname,
        method: req.method,
        identifier: config.identifyBy === "userId" && args.userId ? "user" : "ip",
        requested,
      },
    });
    return null;
  }
}
