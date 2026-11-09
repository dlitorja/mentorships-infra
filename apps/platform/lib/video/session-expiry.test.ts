import { describe, expect, it } from "vitest";

import { MAX_CALL_DURATION_MS } from "@/lib/video/constants";
import {
  SESSION_EXPIRY_JOIN_BUFFER_MS,
  willSessionExpireDuringCall,
} from "@/lib/video/session-expiry";

const NOW = Date.UTC(2026, 10, 5, 20, 55, 0);
const GUARD_WINDOW_MS = MAX_CALL_DURATION_MS + SESSION_EXPIRY_JOIN_BUFFER_MS;

describe("willSessionExpireDuringCall", () => {
  it("returns false when Clerk has not resolved a session", () => {
    expect(willSessionExpireDuringCall(null, NOW)).toBe(false);
  });

  it("returns false when the session outlives the maximum call length", () => {
    const expiresAt = new Date(NOW + GUARD_WINDOW_MS + 1);
    expect(willSessionExpireDuringCall(expiresAt, NOW)).toBe(false);
  });

  it("returns true at the exact guard boundary", () => {
    const expiresAt = new Date(NOW + GUARD_WINDOW_MS);
    expect(willSessionExpireDuringCall(expiresAt, NOW)).toBe(true);
  });

  it("returns true when the session expires during the call", () => {
    // The reported production failure: a weekly 1-hour call whose Clerk
    // session expires ~30 minutes in.
    const expiresAt = new Date(NOW + 30 * 60 * 1000);
    expect(willSessionExpireDuringCall(expiresAt, NOW)).toBe(true);
  });

  it("returns false for an already-expired session (middleware handles it)", () => {
    const expiresAt = new Date(NOW - 1);
    expect(willSessionExpireDuringCall(expiresAt, NOW)).toBe(false);
  });

  it("honours a caller-supplied maximum call duration", () => {
    const expiresAt = new Date(NOW + 90 * 60 * 1000);
    expect(
      willSessionExpireDuringCall(expiresAt, NOW, 60 * 60 * 1000),
    ).toBe(false);
  });
});
