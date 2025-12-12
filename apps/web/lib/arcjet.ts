import arcjet, { detectBot, shield, tokenBucket } from "@arcjet/next";
import { NextResponse, type NextRequest } from "next/server";

type ArcjetMode = "LIVE" | "DRY_RUN";

const arcjetKey = process.env.ARCJET_KEY;
const arcjetEnabled = Boolean(arcjetKey);

const mode: ArcjetMode = process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN";

export type ArcjetPolicy = "default" | "auth" | "booking" | "checkout" | "user";

const allowSearchBots = ["CATEGORY:SEARCH_ENGINE"] as const;

const ajDefault = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // General API traffic (per-IP by default)
          refillRate: 120,
          interval: 60,
          capacity: 120,
        }),
      ],
    })
  : null;

const ajUser = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      characteristics: ["userId"],
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // Authenticated API traffic (per-user)
          refillRate: 120,
          interval: 60,
          capacity: 120,
        }),
      ],
    })
  : null;

const ajAuth = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      rules: [
        shield({ mode }),
        detectBot({ mode, allow: [...allowSearchBots] }),
        tokenBucket({
          mode,
          // OAuth + auth-adjacent endpoints (per-IP)
          refillRate: 20,
          interval: 60,
          capacity: 20,
        }),
      ],
    })
  : null;

const ajCheckout = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      characteristics: ["userId"],
      rules: [
        shield({ mode }),
        detectBot({ mode, allow: [...allowSearchBots] }),
        tokenBucket({
          mode,
          // Checkout creation/verification should be strict (per-user)
          refillRate: 10,
          interval: 60,
          capacity: 10,
        }),
      ],
    })
  : null;

const ajBooking = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      characteristics: ["userId"],
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // Availability + booking endpoints (per-user)
          refillRate: 30,
          interval: 60,
          capacity: 30,
        }),
      ],
    })
  : null;

function isRateLimitReason(reason: unknown): reason is { isRateLimit: () => boolean } {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "isRateLimit" in reason &&
    typeof (reason as { isRateLimit?: unknown }).isRateLimit === "function"
  );
}

function isBotReason(reason: unknown): reason is { isBot: () => boolean } {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "isBot" in reason &&
    typeof (reason as { isBot?: unknown }).isBot === "function"
  );
}

export async function protectWithArcjet(
  req: NextRequest,
  args: {
    policy: ArcjetPolicy;
    userId?: string | null;
    requested?: number;
  }
): Promise<NextResponse | null> {
  const requested = args.requested ?? 1;

  const decision = await (async () => {
    switch (args.policy) {
      case "checkout": {
        if (ajCheckout && args.userId) {
          return ajCheckout.protect(req, { userId: args.userId, requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

      case "booking": {
        if (ajBooking && args.userId) {
          return ajBooking.protect(req, { userId: args.userId, requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

      case "user": {
        if (ajUser && args.userId) {
          return ajUser.protect(req, { userId: args.userId, requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

      case "auth": {
        if (ajAuth) {
          return ajAuth.protect(req, { requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

      case "default":
      default: {
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }
    }
  })();

  if (!decision) {
    return null;
  }

  if (!decision.isDenied()) {
    return null;
  }

  const reason: unknown = decision.reason;

  // Keep responses minimal (avoid leaking enforcement details)
  if (isRateLimitReason(reason) && reason.isRateLimit()) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  if (isBotReason(reason) && reason.isBot()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
