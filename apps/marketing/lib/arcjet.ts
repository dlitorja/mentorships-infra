import arcjet, { shield, tokenBucket, detectBot } from "@arcjet/next";
import { NextResponse, type NextRequest } from "next/server";

type ArcjetMode = "LIVE" | "DRY_RUN";

const arcjetKey = process.env.ARCJET_KEY;
const arcjetEnabled = Boolean(arcjetKey);

const mode: ArcjetMode = process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN";

const ajDefault = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          refillRate: 120,
          interval: 60,
          capacity: 120,
        }),
      ],
    })
  : null;

const ajAdmin = arcjetEnabled
  ? arcjet({
      key: arcjetKey!,
      characteristics: ["userId"],
      rules: [
        shield({ mode }),
        tokenBucket({
          mode,
          refillRate: 60,
          interval: 60,
          capacity: 60,
        }),
        detectBot({
          mode,
          allow: [],
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
          refillRate: 10,
          interval: 60,
          capacity: 20,
        }),
      ],
    })
  : null;

export async function protectWithArcjet(
  req: NextRequest,
  policy: "default" | "admin" | "webhook" = "default"
): Promise<NextResponse | null> {
  if (!arcjetEnabled || !arcjetKey) {
    return null;
  }

  let aj;
  switch (policy) {
    case "admin":
      aj = ajAdmin;
      break;
    case "webhook":
      aj = ajWebhook;
      break;
    default:
      aj = ajDefault;
  }

  if (!aj) {
    return null;
  }

  const decision = await aj.protect(req, { requested: 1 });

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return new NextResponse("Too many requests", { status: 429 });
    }
    if (decision.reason.isBot()) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return new NextResponse("Forbidden", { status: 403 });
  }

  return null;
}
