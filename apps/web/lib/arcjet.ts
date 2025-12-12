import arcjet, { detectBot, shield, tokenBucket } from "@arcjet/next";
import { NextResponse, type NextRequest } from "next/server";

type ArcjetMode = "LIVE" | "DRY_RUN";

const arcjetKey = process.env.ARCJET_KEY;
const arcjetEnabled = Boolean(arcjetKey);

const mode: ArcjetMode = process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN";

export type ArcjetPolicy =
  | "default"
  | "auth"
  | "booking"
  | "checkout"
  | "availability"
  | "instructor"
  | "forms"
  | "webhook"
  | "user";

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
        tokenBucket({
          mode,
          // Long-term guardrail (per-IP)
          refillRate: 2000,
          interval: 3600,
          capacity: 2000,
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
        tokenBucket({
          mode,
          // Long-term guardrail (per-user)
          refillRate: 6000,
          interval: 3600,
          capacity: 6000,
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
          refillRate: 15,
          interval: 60,
          capacity: 15,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-IP)
          refillRate: 60,
          interval: 3600,
          capacity: 60,
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
          // Strict per-minute cap (per-user)
          refillRate: 3,
          interval: 60,
          capacity: 3,
        }),
        tokenBucket({
          mode,
          // Strict per-hour cap (per-user)
          refillRate: 10,
          interval: 3600,
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
          // Session booking (per-user)
          refillRate: 5,
          interval: 60,
          capacity: 5,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-user)
          refillRate: 20,
          interval: 3600,
          capacity: 20,
        }),
      ],
    })
  : null;

const ajAvailabilityUser = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      characteristics: ["userId"],
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // Availability checks (per-user)
          refillRate: 30,
          interval: 60,
          capacity: 30,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-user)
          refillRate: 200,
          interval: 3600,
          capacity: 200,
        }),
      ],
    })
  : null;

const ajAvailabilityPublic = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // Availability checks (per-IP)
          refillRate: 30,
          interval: 60,
          capacity: 30,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-IP)
          refillRate: 200,
          interval: 3600,
          capacity: 200,
        }),
      ],
    })
  : null;

const ajInstructor = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      characteristics: ["userId"],
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // Instructor management (per-user)
          refillRate: 10,
          interval: 60,
          capacity: 10,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-user)
          refillRate: 60,
          interval: 3600,
          capacity: 60,
        }),
      ],
    })
  : null;

const ajForms = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      rules: [
        shield({ mode }),
        detectBot({ mode, allow: [...allowSearchBots] }),
        tokenBucket({
          mode,
          // Contact/waitlist submissions (per-IP)
          refillRate: 3,
          interval: 60,
          capacity: 3,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-IP)
          refillRate: 10,
          interval: 3600,
          capacity: 10,
        }),
      ],
    })
  : null;

const ajWebhook = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          // Webhooks can be bursty, but we still want flood protection (per-IP)
          refillRate: 100,
          interval: 60,
          capacity: 100,
        }),
        tokenBucket({
          mode,
          // Long-term guardrail (per-IP)
          refillRate: 1000,
          interval: 3600,
          capacity: 1000,
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
      case "webhook": {
        if (ajWebhook) {
          return ajWebhook.protect(req, { requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

      case "forms": {
        if (ajForms) {
          return ajForms.protect(req, { requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

      case "availability": {
        if (ajAvailabilityUser && args.userId) {
          return ajAvailabilityUser.protect(req, { userId: args.userId, requested });
        }
        if (ajAvailabilityPublic) {
          return ajAvailabilityPublic.protect(req, { requested });
        }
        if (ajDefault) {
          return ajDefault.protect(req, { requested });
        }
        return null;
      }

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

      case "instructor": {
        if (ajInstructor && args.userId) {
          return ajInstructor.protect(req, { userId: args.userId, requested });
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
