import { inngest } from "../client";
import { db, payments, orders, sessionPacks, seatReservations } from "@mentorships/db";
import { eq } from "drizzle-orm";
import type {
  PaymentCreatedEvent,
  PaymentUpdatedEvent,
  OrderCreatedEvent,
  OrderUpdatedEvent,
  SessionPackCreatedEvent,
  SessionPackUpdatedEvent,
  SeatReservationCreatedEvent,
  SeatReservationUpdatedEvent,
} from "../types";

function getIdempotencyKey(event: { name: string; data: { id?: string; provider?: string; providerPaymentId?: string } }): string {
  if (event.data.provider && event.data.providerPaymentId) {
    return `${event.data.provider}_${event.data.providerPaymentId}`;
  }
  return event.data.id || event.name;
}

export const syncPaymentCreated = inngest.createFunction(
  {
    id: "sync-payment-created",
    name: "Sync Payment Created to SQL",
    retries: 3,
  },
  { event: "data.sync/payment.created" },
  async ({ event, step }) => {
    const payment = event.data;

    await step.run("upsert-payment", async () => {
      const existing = await db
        .select()
        .from(payments)
        .where(eq(payments.providerPaymentId, payment.providerPaymentId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(payments)
          .set({
            orderId: payment.orderId,
            provider: payment.provider,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            refundedAmount: payment.refundedAmount ?? null,
            updatedAt: new Date(payment.updatedAt),
          })
          .where(eq(payments.providerPaymentId, payment.providerPaymentId));
      } else {
        await db.insert(payments).values({
          id: payment.id,
          orderId: payment.orderId,
          provider: payment.provider,
          providerPaymentId: payment.providerPaymentId,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          refundedAmount: payment.refundedAmount ?? null,
          createdAt: new Date(payment.createdAt),
          updatedAt: new Date(payment.updatedAt),
        });
      }
    });

    return { success: true, paymentId: payment.id };
  }
);

export const syncPaymentUpdated = inngest.createFunction(
  {
    id: "sync-payment-updated",
    name: "Sync Payment Updated to SQL",
    retries: 3,
  },
  { event: "data.sync/payment.updated" },
  async ({ event, step }) => {
    const payment = event.data;

    await step.run("update-payment", async () => {
      await db
        .update(payments)
        .set({
          status: payment.status,
          refundedAmount: payment.refundedAmount ?? null,
          updatedAt: new Date(payment.updatedAt),
        })
        .where(eq(payments.providerPaymentId, payment.providerPaymentId));
    });

    return { success: true, paymentId: payment.id };
  }
);

export const syncOrderCreated = inngest.createFunction(
  {
    id: "sync-order-created",
    name: "Sync Order Created to SQL",
    retries: 3,
  },
  { event: "data.sync/order.created" },
  async ({ event, step }) => {
    const order = event.data;

    await step.run("upsert-order", async () => {
      const existing = await db
        .select()
        .from(orders)
        .where(eq(orders.id, order.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(orders)
          .set({
            userId: order.userId,
            status: order.status,
            provider: order.provider,
            totalAmount: order.totalAmount,
            currency: order.currency,
            updatedAt: new Date(order.updatedAt),
          })
          .where(eq(orders.id, order.id));
      } else {
        await db.insert(orders).values({
          id: order.id,
          userId: order.userId,
          status: order.status,
          provider: order.provider,
          totalAmount: order.totalAmount,
          currency: order.currency,
          createdAt: new Date(order.createdAt),
          updatedAt: new Date(order.updatedAt),
        });
      }
    });

    return { success: true, orderId: order.id };
  }
);

export const syncOrderUpdated = inngest.createFunction(
  {
    id: "sync-order-updated",
    name: "Sync Order Updated to SQL",
    retries: 3,
  },
  { event: "data.sync/order.updated" },
  async ({ event, step }) => {
    const order = event.data;

    await step.run("update-order", async () => {
      await db
        .update(orders)
        .set({
          status: order.status,
          updatedAt: new Date(order.updatedAt),
        })
        .where(eq(orders.id, order.id));
    });

    return { success: true, orderId: order.id };
  }
);

export const syncSessionPackCreated = inngest.createFunction(
  {
    id: "sync-session-pack-created",
    name: "Sync Session Pack Created to SQL",
    retries: 3,
  },
  { event: "data.sync/sessionPack.created" },
  async ({ event, step }) => {
    const sessionPack = event.data;

    await step.run("upsert-session-pack", async () => {
      const existing = await db
        .select()
        .from(sessionPacks)
        .where(eq(sessionPacks.id, sessionPack.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(sessionPacks)
          .set({
            userId: sessionPack.userId,
            mentorId: sessionPack.mentorId,
            totalSessions: sessionPack.totalSessions,
            remainingSessions: sessionPack.remainingSessions,
            status: sessionPack.status,
            paymentId: sessionPack.paymentId,
            expiresAt: sessionPack.expiresAt ? new Date(sessionPack.expiresAt) : null,
            updatedAt: new Date(sessionPack.updatedAt),
          })
          .where(eq(sessionPacks.id, sessionPack.id));
      } else {
        await db.insert(sessionPacks).values({
          id: sessionPack.id,
          userId: sessionPack.userId,
          mentorId: sessionPack.mentorId,
          totalSessions: sessionPack.totalSessions,
          remainingSessions: sessionPack.remainingSessions,
          purchasedAt: new Date(sessionPack.purchasedAt),
          expiresAt: sessionPack.expiresAt ? new Date(sessionPack.expiresAt) : null,
          status: sessionPack.status,
          paymentId: sessionPack.paymentId,
          createdAt: new Date(sessionPack.createdAt),
          updatedAt: new Date(sessionPack.updatedAt),
        });
      }
    });

    return { success: true, sessionPackId: sessionPack.id };
  }
);

export const syncSessionPackUpdated = inngest.createFunction(
  {
    id: "sync-session-pack-updated",
    name: "Sync Session Pack Updated to SQL",
    retries: 3,
  },
  { event: "data.sync/sessionPack.updated" },
  async ({ event, step }) => {
    const sessionPack = event.data;

    await step.run("update-session-pack", async () => {
      const updates: Record<string, unknown> = {
        updatedAt: new Date(sessionPack.updatedAt),
      };
      if (sessionPack.remainingSessions !== undefined) {
        updates.remainingSessions = sessionPack.remainingSessions;
      }
      if (sessionPack.status !== undefined) {
        updates.status = sessionPack.status;
      }

      await db
        .update(sessionPacks)
        .set(updates)
        .where(eq(sessionPacks.id, sessionPack.id));
    });

    return { success: true, sessionPackId: sessionPack.id };
  }
);

export const syncSeatReservationCreated = inngest.createFunction(
  {
    id: "sync-seat-reservation-created",
    name: "Sync Seat Reservation Created to SQL",
    retries: 3,
  },
  { event: "data.sync/seatReservation.created" },
  async ({ event, step }) => {
    const seatReservation = event.data;

    await step.run("upsert-seat-reservation", async () => {
      const existing = await db
        .select()
        .from(seatReservations)
        .where(eq(seatReservations.id, seatReservation.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(seatReservations)
          .set({
            userId: seatReservation.userId,
            mentorId: seatReservation.mentorId,
            sessionPackId: seatReservation.sessionPackId,
            status: seatReservation.status,
            seatExpiresAt: seatReservation.seatExpiresAt ? new Date(seatReservation.seatExpiresAt) : null,
            gracePeriodEndsAt: seatReservation.gracePeriodEndsAt ? new Date(seatReservation.gracePeriodEndsAt) : null,
            updatedAt: new Date(seatReservation.updatedAt),
          })
          .where(eq(seatReservations.id, seatReservation.id));
      } else {
        await db.insert(seatReservations).values({
          id: seatReservation.id,
          userId: seatReservation.userId,
          mentorId: seatReservation.mentorId,
          sessionPackId: seatReservation.sessionPackId,
          status: seatReservation.status,
          seatExpiresAt: seatReservation.seatExpiresAt ? new Date(seatReservation.seatExpiresAt) : null,
          gracePeriodEndsAt: seatReservation.gracePeriodEndsAt ? new Date(seatReservation.gracePeriodEndsAt) : null,
          createdAt: new Date(seatReservation.createdAt),
          updatedAt: new Date(seatReservation.updatedAt),
        });
      }
    });

    return { success: true, seatReservationId: seatReservation.id };
  }
);

export const syncSeatReservationUpdated = inngest.createFunction(
  {
    id: "sync-seat-reservation-updated",
    name: "Sync Seat Reservation Updated to SQL",
    retries: 3,
  },
  { event: "data.sync/seatReservation.updated" },
  async ({ event, step }) => {
    const seatReservation = event.data;

    await step.run("update-seat-reservation", async () => {
      const updates: Record<string, unknown> = {
        updatedAt: new Date(seatReservation.updatedAt),
      };
      if (seatReservation.status !== undefined) {
        updates.status = seatReservation.status;
      }
      if (seatReservation.seatExpiresAt !== undefined) {
        updates.seatExpiresAt = seatReservation.seatExpiresAt ? new Date(seatReservation.seatExpiresAt) : null;
      }
      if (seatReservation.gracePeriodEndsAt !== undefined) {
        updates.gracePeriodEndsAt = seatReservation.gracePeriodEndsAt ? new Date(seatReservation.gracePeriodEndsAt) : null;
      }

      await db
        .update(seatReservations)
        .set(updates)
        .where(eq(seatReservations.id, seatReservation.id));
    });

    return { success: true, seatReservationId: seatReservation.id };
  }
);

export const syncHandlers = [
  syncPaymentCreated,
  syncPaymentUpdated,
  syncOrderCreated,
  syncOrderUpdated,
  syncSessionPackCreated,
  syncSessionPackUpdated,
  syncSeatReservationCreated,
  syncSeatReservationUpdated,
];