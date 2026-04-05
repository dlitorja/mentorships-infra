import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse, type NextRequest } from "next/server";

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

function getIp(req: NextRequest): string {
  return (
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
    limiter: Ratelimit.slidingWindow(config.short.limit, config.short.window),
    prefix: `ratelimit:${policy}:short`,
  });
}

export async function protectWithRateLimit(
  req: NextRequest,
  policy: RateLimitPolicy = "default",
  userId?: string | null
): Promise<NextResponse | null> {
  if (!redisEnabled || !redis) {
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

    return new NextResponse("Too many requests", {
      status: 429,
      headers: {
        "Retry-After": "60",
      },
    });
  } catch {
    return null;
  }
}
