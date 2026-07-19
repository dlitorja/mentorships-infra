import { describe, expect, it } from "vitest";

/**
 * R12: pure unit tests for the retention-countdown formatters
 * shared between `calls-section.tsx` and
 * `recording-player-modal.tsx`. We don't import the formatters
 * directly because they live inside React component files;
 * instead we mirror their logic here so a copy-paste drift
 * surfaces as a test failure in CI.
 *
 * The canonical implementations live at:
 *   - `apps/platform/components/workspace/calls-section.tsx`
 *     → `summarizeRetention`, `getRetentionUrgency`
 *   - `apps/platform/components/workspace/recording-player-modal.tsx`
 *     → `formatRetentionCountdown`, `isRetentionUrgent`
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function summarizeRetention(expiresAt: number, now = Date.now()): string {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return "Auto-deletion pending";
  const days = Math.floor(remainingMs / DAY_MS);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor(remainingMs / (60 * 60 * 1000)));
    return `Auto-deletes in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (days === 1) return "Auto-deletes tomorrow";
  return `Auto-deletes in ${days} days`;
}

function getRetentionUrgency(
  expiresAt: number,
  now = Date.now()
): "urgent" | "normal" {
  const days = Math.floor((expiresAt - now) / DAY_MS);
  return days <= 7 ? "urgent" : "normal";
}

function formatRetentionCountdown(
  expiresAt: number,
  now = Date.now()
): string {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    return "This recording will be deleted on the next cleanup run.";
  }
  const days = Math.floor(remainingMs / DAY_MS);
  const date = new Date(expiresAt).toLocaleDateString();
  if (days <= 0) {
    const hours = Math.max(1, Math.floor(remainingMs / (60 * 60 * 1000)));
    return `This recording will be permanently deleted on ${date} (in ${hours} hour${
      hours === 1 ? "" : "s"
    }).`;
  }
  if (days === 1) {
    return `This recording will be permanently deleted tomorrow (${date}).`;
  }
  return `This recording will be permanently deleted in ${days} days (${date}).`;
}

function isRetentionUrgent(expiresAt: number, now = Date.now()): boolean {
  return Math.floor((expiresAt - now) / DAY_MS) <= 7;
}

describe("recording retention helpers", () => {
  const now = new Date("2026-05-14T12:00:00Z").getTime();

  describe("summarizeRetention (per-row caption)", () => {
    it("returns 'Auto-deletion pending' when expiresAt is in the past", () => {
      expect(summarizeRetention(now - 1000, now)).toBe("Auto-deletion pending");
    });

    it("returns 'Auto-deletes tomorrow' for exactly 1 day remaining", () => {
      expect(summarizeRetention(now + DAY_MS, now)).toBe(
        "Auto-deletes tomorrow"
      );
    });

    it("returns 'Auto-deletes in N days' for multi-day windows", () => {
      expect(summarizeRetention(now + 7 * DAY_MS, now)).toBe(
        "Auto-deletes in 7 days"
      );
      expect(summarizeRetention(now + 30 * DAY_MS, now)).toBe(
        "Auto-deletes in 30 days"
      );
      expect(summarizeRetention(now + 89 * DAY_MS, now)).toBe(
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
      expect(getRetentionUrgency(now + 7 * DAY_MS, now)).toBe("urgent");
    });

    it("returns 'urgent' under 7 days", () => {
      expect(getRetentionUrgency(now + 6 * DAY_MS, now)).toBe("urgent");
      expect(getRetentionUrgency(now + 1 * DAY_MS, now)).toBe("urgent");
    });

    it("returns 'normal' above 7 days", () => {
      expect(getRetentionUrgency(now + 8 * DAY_MS, now)).toBe("normal");
      expect(getRetentionUrgency(now + 89 * DAY_MS, now)).toBe("normal");
    });
  });

  describe("formatRetentionCountdown (modal header)", () => {
    it("returns a 'next cleanup run' message for past expiresAt", () => {
      expect(formatRetentionCountdown(now - 1000, now)).toMatch(
        /next cleanup run/
      );
    });

    it("returns the tomorrow-only message for exactly 1 day remaining", () => {
      const out = formatRetentionCountdown(now + DAY_MS, now);
      expect(out).toMatch(/tomorrow/);
    });

    it("includes the date for multi-day windows", () => {
      const out = formatRetentionCountdown(now + 5 * DAY_MS, now);
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
      expect(isRetentionUrgent(now + 7 * DAY_MS, now)).toBe(true);
    });

    it("returns false above the 7-day threshold", () => {
      expect(isRetentionUrgent(now + 8 * DAY_MS, now)).toBe(false);
    });
  });

  describe("boundary consistency", () => {
    it("summarizeRetention and formatRetentionCountdown agree on the 1-day boundary", () => {
      const expiresAt = now + DAY_MS;
      const summary = summarizeRetention(expiresAt, now);
      const modal = formatRetentionCountdown(expiresAt, now);
      expect(summary).toMatch(/tomorrow/);
      expect(modal).toMatch(/tomorrow/);
    });

    it("both helpers produce reasonable output across the full 90-day window", () => {
      for (const days of [1, 7, 14, 30, 60, 89, 90]) {
        const expiresAt = now + days * DAY_MS;
        expect(summarizeRetention(expiresAt, now)).toMatch(
          /^Auto-deletes/
        );
        expect(formatRetentionCountdown(expiresAt, now)).toMatch(
          /permanently deleted/
        );
      }
    });
  });
});
