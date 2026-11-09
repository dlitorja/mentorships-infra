import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";

import {
  assertSessionCanOutliveCall,
  getSessionExpireAtMs,
  isSessionExpiringDuringCall,
  MAX_CALL_DURATION_MS,
  SESSION_EXPIRY_JOIN_BUFFER_MS,
} from "./videoSessionExpiry";

const NOW = Date.UTC(2026, 10, 8, 18, 0, 0);
const GUARD_WINDOW_MS = MAX_CALL_DURATION_MS + SESSION_EXPIRY_JOIN_BUFFER_MS;
const seconds = (ms: number): number => Math.floor(ms / 1000);

describe("getSessionExpireAtMs", () => {
  it("returns null when the claim is absent (legacy token / rollout)", () => {
    expect(getSessionExpireAtMs({})).toBeNull();
  });

  it("parses a Clerk-style Unix-seconds claim", () => {
    const expireAt = NOW + 60 * 60 * 1000;
    expect(getSessionExpireAtMs({ session_expire_at: seconds(expireAt) })).toBe(
      Math.floor(seconds(expireAt)) * 1000
    );
  });

  it("tolerates a millisecond claim and a numeric string", () => {
    expect(getSessionExpireAtMs({ session_expire_at: NOW + 1_000 })).toBe(
      NOW + 1_000
    );
    expect(
      getSessionExpireAtMs({ session_expire_at: String(seconds(NOW + 2_000)) })
    ).toBe(Math.floor(seconds(NOW + 2_000)) * 1000);
  });

  it("returns null for malformed or non-positive values", () => {
    expect(getSessionExpireAtMs({ session_expire_at: "not-a-number" })).toBeNull();
    expect(getSessionExpireAtMs({ session_expire_at: 0 })).toBeNull();
    expect(getSessionExpireAtMs({ session_expire_at: -1 })).toBeNull();
  });
});

describe("isSessionExpiringDuringCall", () => {
  it("fails open when the claim is missing", () => {
    expect(isSessionExpiringDuringCall(null, NOW)).toBe(false);
  });

  it("returns true for a session expiring during the call", () => {
    expect(isSessionExpiringDuringCall(NOW + 30 * 60 * 1000, NOW)).toBe(true);
  });

  it("returns true at the exact guard boundary", () => {
    expect(isSessionExpiringDuringCall(NOW + GUARD_WINDOW_MS, NOW)).toBe(true);
  });

  it("returns false when the session outlives the maximum call length", () => {
    expect(isSessionExpiringDuringCall(NOW + GUARD_WINDOW_MS + 1, NOW)).toBe(
      false
    );
  });

  it("returns true for a session that already expired", () => {
    expect(isSessionExpiringDuringCall(NOW - 1, NOW)).toBe(true);
  });
});

describe("assertSessionCanOutliveCall", () => {
  it("does not throw when the claim is absent", () => {
    expect(() => assertSessionCanOutliveCall({}, NOW)).not.toThrow();
  });

  it("does not throw when the session outlives the call", () => {
    expect(() =>
      assertSessionCanOutliveCall(
        { session_expire_at: seconds(NOW + GUARD_WINDOW_MS + 60_000) },
        NOW
      )
    ).not.toThrow();
  });

  it("throws VIDEO_SESSION_EXPIRING when the session expires during the call", () => {
    try {
      assertSessionCanOutliveCall(
        { session_expire_at: seconds(NOW + 30 * 60 * 1000) },
        NOW
      );
      expect.unreachable("expected assertSessionCanOutliveCall to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as { data?: { code?: string } }).data?.code).toBe(
        "VIDEO_SESSION_EXPIRING"
      );
    }
  });
});
