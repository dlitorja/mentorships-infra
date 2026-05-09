import { action } from "../functions/_generated/migrateLegacyIds";
import { internal } from "./_generated/api";

/**
 * Convex action to resolve legacy IDs to Convex document IDs
 * 
 * This updates v.string() fields that contain legacy UUIDs
 * with actual Convex document IDs after migration.
 * 
 * Usage:
 *   await migrateLegacyIds.resolveLegacyIds();
 */

export const resolveLegacyIds = action({
  args: {},
  handler: async (ctx) => {
    console.log("Starting legacy ID resolution...");

    // Build maps from legacyId to Convex doc ID
    const orders = await ctx.runQuery(internal.query.ordersWithLegacyId, {});
    const payments = await ctx.runQuery(internal.query.paymentsWithLegacyId, {});
    const instructors = await ctx.runQuery(internal.query.instructorsWithLegacyId, {});
    const sessionPacks = await ctx.runQuery(internal.query.sessionPacksWithLegacyId, {});
    const seatReservations = await ctx.runQuery(internal.query.seatReservationsAll, {});

    console.log(`Found: ${orders.length} orders, ${payments.length} payments, ${instructors.length} instructors, ${sessionPacks.length} sessionPacks, ${seatReservations.length} seatReservations`);

    // Build legacyId -> docId maps
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

    let paymentsResolved = 0;
    let sessionPacksResolved = 0;
    let seatReservationsResolved = 0;

    // Step 1: Resolve payments.orderId
    console.log("Resolving payments.orderId...");
    for (const payment of payments) {
      const orderDocId = ordersByLegacyId.get(payment.orderId);
      if (orderDocId) {
        await ctx.runMutation(internal.mutation.updatePaymentsOrderId, {
          paymentId: payment._id,
          orderId: orderDocId,
        });
        paymentsResolved++;
        console.log(`  Payment ${payment._id}: orderId -> ${orderDocId}`);
      } else {
        console.log(`  Payment ${payment._id}: WARNING - no order found for ${payment.orderId}`);
      }
    }

    // Step 2: Resolve sessionPacks mentorId and paymentId
    console.log("Resolving sessionPacks...");
    for (const sp of sessionPacks) {
      const instructorDocId = instructorsByLegacyId.get(sp.mentorId);
      const paymentDocId = paymentsByLegacyId.get(sp.paymentId);

      const updates: { mentorId?: string; paymentId?: string } = {};

      if (instructorDocId) {
        updates.mentorId = instructorDocId;
      } else {
        console.log(`  SessionPack ${sp._id}: WARNING - no instructor for ${sp.mentorId}`);
      }

      if (paymentDocId) {
        updates.paymentId = paymentDocId;
      } else {
        console.log(`  SessionPack ${sp._id}: WARNING - no payment for ${sp.paymentId}`);
      }

      if (updates.mentorId || updates.paymentId) {
        await ctx.runMutation(internal.mutation.updateSessionPacksIds, {
          sessionPackId: sp._id,
          ...updates,
        });
        sessionPacksResolved++;
      }
    }

    // Step 3: Resolve seatReservations
    console.log("Resolving seatReservations...");
    for (const sr of seatReservations) {
      const instructorDocId = instructorsByLegacyId.get(sr.mentorId);
      const sessionPackDocId = sessionPacksByLegacyId.get(sr.sessionPackId);

      const updates: { mentorId?: string; sessionPackId?: string } = {};

      if (instructorDocId) {
        updates.mentorId = instructorDocId;
      } else {
        console.log(`  SeatReservation ${sr._id}: WARNING - no instructor for ${sr.mentorId}`);
      }

      if (sessionPackDocId) {
        updates.sessionPackId = sessionPackDocId;
      } else {
        console.log(`  SeatReservation ${sr._id}: WARNING - no sessionPack for ${sr.sessionPackId}`);
      }

      if (updates.mentorId || updates.sessionPackId) {
        await ctx.runMutation(internal.mutation.updateSeatReservationsIds, {
          seatReservationId: sr._id,
          ...updates,
        });
        seatReservationsResolved++;
      }
    }

    console.log(`\nResolution complete: ${paymentsResolved} payments, ${sessionPacksResolved} sessionPacks, ${seatReservationsResolved} seatReservations resolved`);

    return {
      paymentsResolved,
      sessionPacksResolved,
      seatReservationsResolved,
    };
  },
});