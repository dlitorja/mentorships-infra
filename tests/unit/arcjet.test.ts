import { describe, it, expect } from "vitest";
import { arcjetDecisionToResponse } from "@/lib/arcjet";

describe("arcjetDecisionToResponse", () => {
  it("returns null when decision is not denied", async () => {
    const res = arcjetDecisionToResponse({ isDenied: () => false, reason: null });
    expect(res).toBeNull();
  });

  it("returns 429 for rate limit denial", async () => {
    const res = arcjetDecisionToResponse({
      isDenied: () => true,
      reason: { isRateLimit: () => true },
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("60");
  });

  it("returns 403 for bot denial", async () => {
    const res = arcjetDecisionToResponse({
      isDenied: () => true,
      reason: { isBot: () => true },
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("returns 403 for generic denial", async () => {
    const res = arcjetDecisionToResponse({
      isDenied: () => true,
      reason: { somethingElse: true },
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });
});

