/**
 * R12: pure formatting helpers shared between
 * `apps/platform/components/workspace/calls-section.tsx`,
 * `apps/platform/components/workspace/recording-player-modal.tsx`,
 * and `apps/platform/lib/recording-retention.test.ts`.
 *
 * Centralised here (CodeRabbit #2) so a copy-paste drift surfaces
 * as a typecheck or test failure in CI instead of as a UI bug.
 *
 * All functions are pure: `now` is injectable for tests, defaults
 * to `Date.now()` in production.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-row caption under each recording in `calls-section.tsx`.
 * Tight urgency thresholds: anything ≤7 days is coloured red.
 */
export function summarizeRetention(
  expiresAt: number,
  now: number = Date.now()
): string {
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

/**
 * Per-row urgency bucket — drives the `text-destructive` colour
 * in the calls list. ≤7d = urgent, >7d = normal.
 */
export function getRetentionUrgency(
  expiresAt: number,
  now: number = Date.now()
): "urgent" | "normal" {
  const days = Math.floor((expiresAt - now) / DAY_MS);
  return days <= 7 ? "urgent" : "normal";
}

/**
 * Modal header countdown line in `recording-player-modal.tsx`.
 * Includes the deletion date so users have a concrete calendar
 * reference.
 */
export function formatRetentionCountdown(
  expiresAt: number,
  now: number = Date.now()
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

/**
 * Modal urgency flag — flips the countdown text colour.
 */
export function isRetentionUrgent(
  expiresAt: number,
  now: number = Date.now()
): boolean {
  return Math.floor((expiresAt - now) / DAY_MS) <= 7;
}
