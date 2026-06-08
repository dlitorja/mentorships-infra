import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled cron jobs for background processing.
 * - send-grace-period-final-warning: Runs hourly, sends final warning to seats entering grace period
 * - check-seat-expiration: Runs hourly, processes expired seats and transitions to grace or released
 * - process-discord-action-queue: Runs every minute, processes pending Discord actions
 */
const crons = cronJobs();

crons.interval(
  "send-grace-period-final-warning",
  { hours: 1 },
  internal.seatReservations.sendGracePeriodFinalWarning,
  {}
);

crons.interval(
  "check-seat-expiration",
  { hours: 1 },
  internal.sessions.checkSeatExpiration,
  {}
);

crons.interval(
  "process-discord-action-queue",
  { minutes: 1 },
  internal.discordActionQueue.processDiscordActionQueue,
  {}
);

export default crons;