import { mutation } from "./_generated/server";

/**
 * Resolve all legacy UUID string IDs to proper Convex document IDs.
 * Run with: npx convex run migrateIds:resolveAllLegacyIds
 */
export const resolveAllLegacyIds = mutation({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("orders").collect();
    const payments = await ctx.db.query("payments").collect();
    const instructors = await ctx.db.query("instructors").collect();
    const sessionPacks = await ctx.db.query("sessionPacks").collect();
    const seatReservations = await ctx.db.query("seatReservations").collect();

    const ordersByLegacyId = new Map<string, string>();
    for (const order of orders) {
      if (order.legacyId) ordersByLegacyId.set(order.legacyId, order._id);
    }

    const paymentsByLegacyId = new Map<string, string>();
    for (const payment of payments) {
      if (payment.legacyId) paymentsByLegacyId.set(payment.legacyId, payment._id);
    }

    const instructorsByLegacyId = new Map<string, string>();
    for (const instructor of instructors) {
      if (instructor.legacyId) instructorsByLegacyId.set(instructor.legacyId, instructor._id);
    }

    const sessionPacksByLegacyId = new Map<string, string>();
    for (const sp of sessionPacks) {
      if (sp.legacyId) sessionPacksByLegacyId.set(sp.legacyId, sp._id);
    }

    let resolvedPayments = 0;
    let resolvedSessionPacks = 0;
    let resolvedSeatReservations = 0;
    let failedPayments = 0;
    let failedSessionPacks = 0;
    let failedSeatReservations = 0;

    for (const payment of payments) {
      const targetOrderId = ordersByLegacyId.get(payment.orderId as string);
      if (targetOrderId) {
        await ctx.db.patch(payment._id, { orderId: targetOrderId });
        resolvedPayments++;
      } else {
        failedPayments++;
      }
    }

    for (const sp of sessionPacks) {
      const instructorId = instructorsByLegacyId.get(sp.mentorId as string);
      const paymentDocId = paymentsByLegacyId.get(sp.paymentId as string);

      if (instructorId && paymentDocId) {
        await ctx.db.patch(sp._id, { mentorId: instructorId, paymentId: paymentDocId });
        resolvedSessionPacks++;
      } else {
        failedSessionPacks++;
      }
    }

    for (const sr of seatReservations) {
      const instructorId = instructorsByLegacyId.get(sr.mentorId as string);
      const sessionPackId = sessionPacksByLegacyId.get(sr.sessionPackId as string);

      if (instructorId && sessionPackId) {
        await ctx.db.patch(sr._id, { mentorId: instructorId, sessionPackId: sessionPackId });
        resolvedSeatReservations++;
      } else {
        failedSeatReservations++;
      }
    }

    return {
      resolved: {
        payments: resolvedPayments,
        sessionPacks: resolvedSessionPacks,
        seatReservations: resolvedSeatReservations,
      },
      failed: {
        payments: failedPayments,
        sessionPacks: failedSessionPacks,
        seatReservations: failedSeatReservations,
      },
      maps: {
        orders: ordersByLegacyId.size,
        payments: paymentsByLegacyId.size,
        instructors: instructorsByLegacyId.size,
        sessionPacks: sessionPacksByLegacyId.size,
      },
    };
  },
});