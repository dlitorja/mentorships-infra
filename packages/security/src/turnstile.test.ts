import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyTurnstileToken,
  isTurnstileTokenValid,
  getClientIp,
} from "./turnstile";

describe("turnstile", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test_secret_key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  describe("verifyTurnstileToken", () => {
    it("returns success=true for a valid token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          success: true,
          challenge_ts: "2026-08-16T00:00:00Z",
          hostname: "example.com",
          action: "share-download",
        }),
      });

      const result = await verifyTurnstileToken("valid_token", {
        remoteIp: "1.2.3.4",
      });

      expect(result.success).toBe(true);
      expect(result.hostname).toBe("example.com");
      expect(result.action).toBe("share-download");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall).toBeDefined();
      const callArg = firstCall![1] as { body: FormData } | undefined;
      expect(callArg).toBeDefined();
      const formData = callArg!.body;
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get("secret")).toBe("test_secret_key");
      expect(formData.get("response")).toBe("valid_token");
      expect(formData.get("remoteip")).toBe("1.2.3.4");
    });

    it("returns success=false when token is missing", async () => {
      global.fetch = vi.fn();

      const result = await verifyTurnstileToken("");

      expect(result.success).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns success=false when secret key is missing", async () => {
      vi.unstubAllEnvs();
      global.fetch = vi.fn();

      const result = await verifyTurnstileToken("some_token");

      expect(result.success).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns success=false when Cloudflare returns success=false", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      });

      const result = await verifyTurnstileToken("bad_token");

      expect(result.success).toBe(false);
      expect(result.errorCodes).toEqual(["timeout-or-duplicate"]);
    });

    it("returns success=false when the network request fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await verifyTurnstileToken("token");

      expect(result.success).toBe(false);
    });

    it("returns success=false when the response shape is unexpected", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({ unexpected: "payload" }),
      });

      const result = await verifyTurnstileToken("token");

      expect(result.success).toBe(false);
    });

    it("returns success=false when the action does not match the expected action", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          success: true,
          action: "other-action",
        }),
      });

      const result = await verifyTurnstileToken("token", {
        action: "share-download",
      });

      expect(result.success).toBe(false);
      expect(result.action).toBe("other-action");
    });

    it("returns success=true when the action matches the expected action", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          success: true,
          action: "share-download",
        }),
      });

      const result = await verifyTurnstileToken("token", {
        action: "share-download",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("share-download");
    });
  });

  describe("isTurnstileTokenValid", () => {
    it("returns true for valid token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({ success: true }),
      });

      expect(await isTurnstileTokenValid("valid")).toBe(true);
    });

    it("returns false for invalid token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => ({ success: false }),
      });

      expect(await isTurnstileTokenValid("invalid")).toBe(false);
    });
  });

  describe("getClientIp", () => {
    it("prefers cf-connecting-ip", () => {
      const req = new Request("http://localhost", {
        headers: {
          "cf-connecting-ip": "1.2.3.4",
          "x-forwarded-for": "5.6.7.8, 9.10.11.12",
          "x-real-ip": "13.14.15.16",
        },
      });

      expect(getClientIp(req)).toBe("1.2.3.4");
    });

    it("falls back to x-forwarded-for first address", () => {
      const req = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "5.6.7.8, 9.10.11.12",
          "x-real-ip": "13.14.15.16",
        },
      });

      expect(getClientIp(req)).toBe("5.6.7.8");
    });

    it("falls back to x-real-ip", () => {
      const req = new Request("http://localhost", {
        headers: {
          "x-real-ip": "13.14.15.16",
        },
      });

      expect(getClientIp(req)).toBe("13.14.15.16");
    });

    it("returns undefined when no headers are present", () => {
      const req = new Request("http://localhost");

      expect(getClientIp(req)).toBeUndefined();
    });
  });
});
