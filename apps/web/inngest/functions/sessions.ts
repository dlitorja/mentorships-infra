import { inngest } from "../client";
import {
  db,
  sessions,
  sessionPacks,
  seatReservations,
  getSessionById,
  getSessionPackById,
  getCompletedSessionCount,
  decrementRemainingSessions,
  updateSeatReservationStatus,
  updateSessionPackStatus,
  eq,
  and,
  lte,
  sql,
} from "@mentorships/db";

/**
 * Handle session completion
 * - Decrements remaining sessions
 * - Updates pack status if depleted
 * - Triggers renewal reminders based on session number
 */
export const handleSessionCompleted = inngest.createFunction(
  {
    id: "handle-session-completed",
    name: "Handle Session Completed",
    retries: 3,
  },
  { event: "session/completed" },
  async ({ event, step }) => {
    const { sessionId, sessionPackId, userId } = event.data;

    // Step 1: Get session and verify it's completed
    const session = await step.run("get-session", async () => {
      const sess = await getSessionById(sessionId);
      if (!sess) {
        throw new Error(`Session ${sessionId} not found`);
      }
      if (sess.status !== "completed") {
        throw new Error(`Session ${sessionId} is not completed`);
      }
      return sess;
    });

    // Step 2: Get session pack
    const pack = await step.run("get-session-pack", async () => {
      const p = await getSessionPackById(sessionPackId);
      if (!p) {
        throw new Error(`Session pack ${sessionPackId} not found`);
      }
      return p;
    });

    // Step 3: Decrement remaining sessions (idempotent check - only if not already decremented)
    const updatedPack = await step.run("decrement-sessions", async () => {
      // Check if we've already processed this session
      // We can check by seeing if remaining_sessions matches expected value
      // For idempotency, we'll use a transaction-safe decrement
      return await decrementRemainingSessions(sessionPackId);
    });

    // Step 4: Count completed sessions to determine session number
    const completedCount = await step.run("count-completed-sessions", async () => {
      return await getCompletedSessionCount(sessionPackId);
    });

    // Step 5: Handle seat status based on remaining sessions
    await step.run("update-seat-status", async () => {
      if (updatedPack.remainingSessions === 0) {
        // All sessions used - start grace period (72 hours)
        const gracePeriodEndsAt = new Date();
        gracePeriodEndsAt.setHours(gracePeriodEndsAt.getHours() + 72);

        await updateSeatReservationStatus(
          sessionPackId,
          "grace",
          gracePeriodEndsAt
        );

        // Mark pack as depleted
        await updateSessionPackStatus(sessionPackId, "depleted", 0);
      }
    });

    // Step 6: Trigger renewal reminders based on session number
    if (completedCount === 3) {
      // Session 3 completed - send renewal reminder
      await step.run("trigger-session-3-reminder", async () => {
        await inngest.send({
          name: "session/renewal-reminder",
          data: {
            sessionPackId,
            userId,
            sessionNumber: 3,
            remainingSessions: updatedPack.remainingSessions,
          },
        });
      });
    } else if (completedCount === 4) {
      // Session 4 completed - send final renewal notice
      await step.run("trigger-session-4-reminder", async () => {
        await inngest.send({
          name: "session/renewal-reminder",
          data: {
            sessionPackId,
            userId,
            sessionNumber: 4,
            remainingSessions: updatedPack.remainingSessions,
            gracePeriodEndsAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 hours
          },
        });
      });
    }

    return {
      success: true,
      sessionId,
      sessionPackId,
      remainingSessions: updatedPack.remainingSessions,
      completedCount,
    };
  }
);

/**
 * Scheduled job to check and release expired seats
 * Runs every hour to check for:
 * - Expired packs with all sessions completed
 * - Expired grace periods
 */
export const checkSeatExpiration = inngest.createFunction(
  {
    id: "check-seat-expiration",
    name: "Check Seat Expiration",
    retries: 2,
  },
  { cron: "0 * * * *" }, // Every hour
  async ({ step }) => {
    const now = new Date();

    // Step 1: Find expired packs that need seat release
    const expiredPacks = await step.run("find-expired-packs", async () => {
      // Get packs that are expired or depleted and past expiration
      const packs = await db
        .select()
        .from(sessionPacks)
        .where(
          and(
            sql`${sessionPacks.status} IN ('expired', 'depleted')`,
            lte(sessionPacks.expiresAt, now)
          )
        );

      return packs;
    });

    // Step 2: Check each pack for scheduled sessions
    for (const pack of expiredPacks) {
      await step.run(`check-pack-${pack.id}`, async () => {
        // Check if there are any scheduled (not completed) sessions
        const scheduledSessions = await db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.sessionPackId, pack.id),
              eq(sessions.status, "scheduled")
            )
          )
          .limit(1);

        // Only release seat if no scheduled sessions remain
        if (scheduledSessions.length === 0) {
          await updateSeatReservationStatus(pack.id, "released");
        }
      });
    }

    // Step 3: Find seats with expired grace periods
    const expiredGraceSeats = await step.run("find-expired-grace-seats", async () => {
      const seats = await db
        .select()
        .from(seatReservations)
        .where(
          and(
            eq(seatReservations.status, "grace"),
            sql`${seatReservations.gracePeriodEndsAt} IS NOT NULL`,
            lte(seatReservations.gracePeriodEndsAt, now)
          )
        );

      return seats;
    });

    // Step 4: Release seats with expired grace periods
    for (const seat of expiredGraceSeats) {
      await step.run(`release-seat-${seat.id}`, async () => {
        await updateSeatReservationStatus(seat.sessionPackId, "released");
      });
    }

    return {
      success: true,
      expiredPacksChecked: expiredPacks.length,
      expiredGraceSeatsReleased: expiredGraceSeats.length,
    };
  }
);

/**
 * Handle renewal reminder notifications
 * Sends notifications for session 3 and 4 completion
 */
export const handleRenewalReminder = inngest.createFunction(
  {
    id: "handle-renewal-reminder",
    name: "Handle Renewal Reminder",
    retries: 2,
  },
  { event: "session/renewal-reminder" },
  async ({ event, step }) => {
    const { sessionPackId, userId, sessionNumber, remainingSessions, gracePeriodEndsAt } =
      event.data;

    // Step 1: Get pack and user info
    const pack = await step.run("get-pack", async () => {
      return await getSessionPackById(sessionPackId);
    });

    if (!pack) {
      throw new Error(`Session pack ${sessionPackId} not found`);
    }

    // Step 2: Send notifications based on session number
    if (sessionNumber === 3) {
      // Session 3: Reminder that 1 session remains
      await step.run("send-session-3-notification", async () => {
        // TODO: Integrate with Discord bot and email service
        // For now, we'll just log the event
        console.log(`Session 3 reminder for pack ${sessionPackId}, user ${userId}`);
        
        // Trigger Discord notification event
        await inngest.send({
          name: "notification/send",
          data: {
            type: "renewal_reminder",
            userId,
            sessionPackId,
            message: "You have 1 session remaining. Renew now to continue your mentorship.",
            sessionNumber: 3,
          },
        });
      });
    } else if (sessionNumber === 4) {
      // Session 4: Final reminder with grace period info
      await step.run("send-session-4-notification", async () => {
        console.log(
          `Session 4 reminder for pack ${sessionPackId}, user ${userId}, grace period ends: ${gracePeriodEndsAt}`
        );

        // Trigger Discord notification event
        await inngest.send({
          name: "notification/send",
          data: {
            type: "final_renewal_reminder",
            userId,
            sessionPackId,
            message: `Your pack is complete. Renew within 72 hours to keep your seat. Grace period ends: ${gracePeriodEndsAt}`,
            sessionNumber: 4,
            gracePeriodEndsAt,
          },
        });
      });
    }

    return {
      success: true,
      sessionPackId,
      userId,
      sessionNumber,
    };
  }
);

/**
 * Scheduled job to send final warning before grace period expires
 * Runs every hour to check for seats expiring in the next 12 hours
 */
export const sendGracePeriodFinalWarning = inngest.createFunction(
  {
    id: "send-grace-period-final-warning",
    name: "Send Grace Period Final Warning",
    retries: 2,
  },
  { cron: "0 * * * *" }, // Every hour
  async ({ step }) => {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours from now

    // Step 1: Find seats expiring in next 12 hours
    const seatsNeedingWarning = await step.run("find-seats-needing-warning", async () => {
      const seats = await db
        .select()
        .from(seatReservations)
        .where(
          and(
            eq(seatReservations.status, "grace"),
            sql`${seatReservations.gracePeriodEndsAt} IS NOT NULL`,
            lte(seatReservations.gracePeriodEndsAt, warningThreshold),
            sql`${seatReservations.gracePeriodEndsAt} > ${now}`
          )
        );

      return seats;
    });

    // Step 2: Check if we've already sent warning (could use a flag, but for now we'll send)
    for (const seat of seatsNeedingWarning) {
      await step.run(`send-warning-${seat.id}`, async () => {
        // Get pack to find user
        const pack = await getSessionPackById(seat.sessionPackId);
        if (!pack) {
          return;
        }

        // Send final warning notification
        await inngest.send({
          name: "notification/send",
          data: {
            type: "grace_period_final_warning",
            userId: pack.userId,
            sessionPackId: seat.sessionPackId,
            message: `Your seat will be released in 12 hours. Renew now to keep your mentorship active.`,
            gracePeriodEndsAt: seat.gracePeriodEndsAt,
          },
        });
      });
    }

    return {
      success: true,
      warningsSent: seatsNeedingWarning.length,
    };
  }
);

