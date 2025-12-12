export type ObservabilityLevel = "debug" | "info" | "warn" | "error";

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

type ObservabilityEvent = {
  message: string;
  level: ObservabilityLevel;
  timestamp: string;
  source: string;
  context?: Record<string, JsonValue>;
};

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonValue(v);
    }
    return out;
  }
  return String(value);
}

function errorToContext(error: unknown): Record<string, JsonValue> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      // Stack can contain paths; keep it, but truncate to avoid huge payloads.
      errorStack: typeof error.stack === "string" ? error.stack.slice(0, 4000) : null,
    };
  }

  return {
    errorName: "UnknownError",
    errorMessage: typeof error === "string" ? error : JSON.stringify(toJsonValue(error)),
  };
}

async function sendToBetterStack(event: ObservabilityEvent): Promise<void> {
  const token = process.env.BETTERSTACK_SOURCE_TOKEN;
  if (!token) return;

  await fetch("https://in.logs.betterstack.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(event),
  });
}

async function sendToAxiom(event: ObservabilityEvent): Promise<void> {
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;
  if (!token || !dataset) return;

  // Axiom ingest uses your EDGE deployment base domain (not api.axiom.co).
  // Ref: https://axiom.co/docs/restapi/introduction
  const baseUrl =
    process.env.AXIOM_INGEST_URL ||
    process.env.AXIOM_URL ||
    "https://api.axiom.co";

  // Axiom ingest expects an array of events.
  await fetch(`${baseUrl}/v1/ingest/${encodeURIComponent(dataset)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([
      {
        ...event,
        // Preferred timestamp field for Axiom queries
        _time: event.timestamp,
      },
    ]),
  });
}

/**
 * Best-effort error reporting. Never throws.
 * Designed to be safe to call from middleware/edge.
 */
export async function reportError(args: {
  source: string;
  error: unknown;
  message?: string;
  level?: ObservabilityLevel;
  context?: Record<string, unknown>;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const level: ObservabilityLevel = args.level ?? "error";

  const context: Record<string, JsonValue> = {
    ...errorToContext(args.error),
    ...(args.context ? (toJsonValue(args.context) as Record<string, JsonValue>) : {}),
  };

  const event: ObservabilityEvent = {
    source: args.source,
    message: args.message ?? "Unhandled error",
    level,
    timestamp,
    context,
  };

  try {
    await Promise.allSettled([sendToBetterStack(event), sendToAxiom(event)]);
  } catch {
    // Fail closed: observability must never break production traffic.
  }
}

