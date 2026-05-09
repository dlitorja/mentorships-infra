import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "send-grace-period-final-warning",
  { hours: 1 },
  internal.seatReservations.sendGracePeriodFinalWarning,
  {}
);

export default crons;