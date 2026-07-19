import { describe, expect, it } from "vitest";
import {
  formatRetentionCountdown,
  getRetentionUrgency,
  isRetentionUrgent,
  summarizeRetention,
} from "./recording-retention";

/**
 * R12: pure unit tests for the retention-countdown formatters
 * in `apps/platform/lib/recording-retention.ts`. These
 * functions are imported by both
 * `apps/platform/components/workspace/calls-section.tsx` and
 * `apps/platform/components/workspace/recording-player-modal.tsx`
 * — centralising them here (CodeRabbit #2) means a copy-paste
 * drift surfaces as a typecheck or test failure in CI instead
 * of as a UI bug.
 *
 * Each function takes an injectable `now` so the test can
 * pin time without monkey-patching `Date.now()`.
 */

describe("recording retention helpers", () => {
  const now = new Date("2026-05-14T12:00:00Z").getTime();

  describe("summarizeRetention (per-row caption)", () => {
    it("returns 'Auto-deletion pending' when expiresAt is in the past", () => {
      expect(summarizeRetention(now - 1000, now)).toBe("Auto-deletion pending");
    });

    it("returns 'Auto-deletes tomorrow' for exactly 1 day remaining", () => {
      expect(summarizeRetention(now + 24 * 60 * 60 * 1000, now)).toBe(
        "Auto-deletes tomorrow"
      );
    });

    it("returns 'Auto-deletes in N days' for multi-day windows", () => {
      expect(summarizeRetention(now + 7 * 24 * 60 * 60 * 1000, now)).toBe(
        "Auto-deletes in 7 days"
      );
      expect(summarizeRetention(now + 30 * 24 * 60 * 60 * 1000, now)).toBe(
        "Auto-deletes in 30 days"
      );
      expect(summarizeRetention(now + 89 * 24 * 60 * 60 * 1000, now)).toBe(
        "Auto-deletes in 89 days"
      );
    });

    it("returns 'Auto-deletes in N hours' for sub-day windows", () => {
      expect(summarizeRetention(now + 6 * 60 * 60 * 1000, now)).toBe(
        "Auto-deletes in 6 hours"
      );
      expect(summarizeRetention(now + 60 * 60 * 1000, now)).toBe(
        "Auto-deletes in 1 hour"
      );
    });
  });

  describe("getRetentionUrgency", () => {
    it("returns 'urgent' at 7 days", () => {
      expect(getRetentionUrgency(now + 7 * 24 * 60 * 60 * 1000, now)).toBe(
        "urgent"
      );
    });

    it("returns 'urgent' under 7 days", () => {
      expect(getRetentionUrgency(now + 6 * 24 * 60 * 60 * 1000, now)).toBe(
        "urgent"
      );
      expect(getRetentionUrgency(now + 1 * 24 * 60 * 60 * 1000, now)).toBe(
        "urgent"
      );
    });

    it("returns 'normal' above 7 days", () => {
      expect(getRetentionUrgency(now + 8 * 24 * 60 * 60 * 1000, now)).toBe(
        "normal"
      );
      expect(getRetentionUrgency(now + 89 * 24 * 60 * 60 * 1000, now)).toBe(
        "normal"
      );
    });
  });

  describe("formatRetentionCountdown (modal header)", () => {
    it("returns a 'next cleanup run' message for past expiresAt", () => {
      expect(formatRetentionCountdown(now - 1000, now)).toMatch(
        /next cleanup run/
      );
    });

    it("returns the tomorrow-only message for exactly 1 day remaining", () => {
      const out = formatRetentionCountdown(now + 24 * 60 * 60 * 1000, now);
      expect(out).toMatch(/tomorrow/);
    });

    it("includes the date for multi-day windows", () => {
      const out = formatRetentionCountdown(now + 5 * 24 * 60 * 60 * 1000, now);
      expect(out).toMatch(/5 days/);
    });

    it("uses singular 'hour' for 1-hour sub-day windows", () => {
      const out = formatRetentionCountdown(now + 60 * 60 * 1000, now);
      expect(out).toMatch(/in 1 hour\)/);
    });

    it("uses plural 'hours' for multi-hour sub-day windows", () => {
      const out = formatRetentionCountdown(now + 5 * 60 * 60 * 1000, now);
      expect(out).toMatch(/in 5 hours\)/);
    });
  });

  describe("isRetentionUrgent", () => {
    it("returns true at the 7-day threshold", () => {
      expect(isRetentionUrgent(now + 7 * 24 * 60 * 60 * 1000, now)).toBe(true);
    });

    it("returns false above the 7-day threshold", () => {
      expect(isRetentionUrgent(now + 8 * 24 * 60 * 60 * 1000, now)).toBe(
        false
      );
    });
  });

  describe("boundary consistency", () => {
    it("summarizeRetention and formatRetentionCountdown agree on the 1-day boundary", () => {
      const expiresAt = now + 24 * 60 * 60 * 1000;
      const summary = summarizeRetention(expiresAt, now);
      const modal = formatRetentionCountdown(expiresAt, now);
      expect(summary).toMatch(/tomorrow/);
      expect(modal).toMatch(/tomorrow/);
    });

    it("both helpers produce reasonable output across the full 90-day window", () => {
      for (const days of [1, 7, 14, 30, 60, 89, 90]) {
        const expiresAt = now + days * 24 * 60 * 60 * 1000;
        expect(summarizeRetention(expiresAt, now)).toMatch(/^Auto-deletes/);
        expect(formatRetentionCountdown(expiresAt, now)).toMatch(
          /permanently deleted/
        );
      }
    });
  });
});
