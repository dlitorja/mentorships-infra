import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

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