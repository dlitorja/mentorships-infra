import { action } from "../convex/_generated/server";
import { internal } from "../convex/_generated/api";

export const resolveLegacyIds = action({
  args: {},
  handler: async (ctx) => {
    // Query all data
    const orders = await ctx.runQuery(internal.query.ordersAll, {});
    const payments = await ctx.runQuery(internal.query.paymentsAll, {});
    const instructors = await ctx.runQuery(internal.query.instructorsAll, {});
    const sessionPacks = await ctx.runQuery(internal.query.sessionPacksAll, {});
    const seatReservations = await ctx.runQuery(internal.query.seatReservationsAll, {});

    // Build legacy ID maps
    const ordersByLegacyId = new Map<string, string>();
    for (const order of orders) {
      if (order.legacyId) {
        ordersByLegacyId.set(order.legacyId, order._id);
      }
    }

    const paymentsByLegacyId = new Map<string, string>();
    for (const payment of payments) {
      if (payment.legacyId) {
        paymentsByLegacyId.set(payment.legacyId, payment._id);
      }
    }

    const instructorsByLegacyId = new Map<string, string>();
    for (const instructor of instructors) {
      if (instructor.legacyId) {
        instructorsByLegacyId.set(instructor.legacyId, instructor._id);
      }
    }

    const sessionPacksByLegacyId = new Map<string, string>();
    for (const sp of sessionPacks) {
      if (sp.legacyId) {
        sessionPacksByLegacyId.set(sp.legacyId, sp._id);
      }
    }

    const results = {
      orders: orders.length,
      payments: payments.length,
      instructors: instructors.length,
      sessionPacks: sessionPacks.length,
      seatReservations: seatReservations.length,
      maps: {
        ordersByLegacyId: ordersByLegacyId.size,
        paymentsByLegacyId: paymentsByLegacyId.size,
        instructorsByLegacyId: instructorsByLegacyId.size,
        sessionPacksByLegacyId: sessionPacksByLegacyId.size,
      },
      resolved: {
        payments: 0,
        sessionPacks: 0,
        seatReservations: 0,
      },
      failed: {
        payments: 0,
        sessionPacks: 0,
        seatReservations: 0,
      },
    };

    // Resolve payments.orderId
    for (const payment of payments) {
      const targetOrderId = ordersByLegacyId.get(payment.orderId as string);
      if (targetOrderId) {
        await ctx.runMutation(internal.mutation.paymentsUpdateOrderId, {
          id: payment._id,
          orderId: targetOrderId,
        });
        results.resolved.payments++;
      } else {
        results.failed.payments++;
      }
    }

    // Resolve sessionPacks
    for (const sp of sessionPacks) {
      const updates: { mentorId?: string; paymentId?: string } = {};
      
      const targetInstructorId = instructorsByLegacyId.get(sp.mentorId as string);
      if (targetInstructorId) {
        updates.mentorId = targetInstructorId;
      } else {
        results.failed.sessionPacks++;
        continue;
      }

      const targetPaymentId = paymentsByLegacyId.get(sp.paymentId as string);
      if (targetPaymentId) {
        updates.paymentId = targetPaymentId;
      } else {
        results.failed.sessionPacks++;
        continue;
      }

      await ctx.runMutation(internal.mutation.sessionPacksUpdateIds, {
        id: sp._id,
        ...updates,
      });
      results.resolved.sessionPacks++;
    }

    // Resolve seatReservations
    for (const sr of seatReservations) {
      const updates: { mentorId?: string; sessionPackId?: string } = {};

      const targetInstructorId = instructorsByLegacyId.get(sr.mentorId as string);
      if (targetInstructorId) {
        updates.mentorId = targetInstructorId;
      } else {
        results.failed.seatReservations++;
        continue;
      }

      const targetSessionPackId = sessionPacksByLegacyId.get(sr.sessionPackId as string);
      if (targetSessionPackId) {
        updates.sessionPackId = targetSessionPackId;
      } else {
        results.failed.seatReservations++;
        continue;
      }

      await ctx.runMutation(internal.mutation.seatReservationsUpdateIds, {
        id: sr._id,
        ...updates,
      });
      results.resolved.seatReservations++;
    }

    return results;
  },
});