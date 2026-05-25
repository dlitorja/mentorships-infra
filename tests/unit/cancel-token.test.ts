import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

function sign(orderId: string, ts: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}:${ts}`).digest("hex");
}

function isValid(orderId: string, ts: string | null, token: string | null, secret: string, windowMs = 48 * 3600 * 1000): boolean {
  if (!ts || !token) return false;
  const withinWindow = Date.now() - Number(ts) < windowMs;
  if (!withinWindow) return false;
  const expected = sign(orderId, ts, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

describe("cancel token verification", () => {
  const secret = "test_secret";
  const orderId = "order_123";

  it("accepts valid token within window", () => {
    const ts = Date.now().toString();
    const token = sign(orderId, ts, secret);
    expect(isValid(orderId, ts, token, secret)).toBe(true);
  });

  it("rejects invalid token", () => {
    const ts = Date.now().toString();
    const token = sign(orderId, ts, secret) + "deadbeef";
    expect(isValid(orderId, ts, token, secret)).toBe(false);
  });

  it("rejects expired token", () => {
    const ts = (Date.now() - 49 * 3600 * 1000).toString();
    const token = sign(orderId, ts, secret);
    expect(isValid(orderId, ts, token, secret)).toBe(false);
  });
});
