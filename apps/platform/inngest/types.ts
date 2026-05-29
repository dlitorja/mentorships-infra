import { z } from "zod";

// Event schemas with runtime validation
// Note: orderId and packId are Convex IDs, not UUIDs
export const purchaseMentorshipEventSchema = z.object({
  name: z.literal("purchase/mentorship"),
  data: z.object({
    orderId: z.string(),
    clerkId: z.string(),
    packId: z.string(),
    provider: z.enum(["stripe", "paypal"]),
  }),
});

export const stripeCheckoutCompletedEventSchema = z.object({
  name: z.literal("stripe/checkout.session.completed"),
  data: z.object({
    sessionId: z.string(),
    orderId: z.string(),
    userId: z.string(), // Clerk user ID from metadata
    packId: z.string(),
    studentEmail: z.string().email().optional(),
  }),
});

export const stripeChargeRefundedEventSchema = z.object({
  name: z.literal("stripe/charge.refunded"),
  data: z.object({
    chargeId: z.string(),
    paymentIntentId: z.string(),
  }),
});

export const paypalPaymentCompletedEventSchema = z.object({
  name: z.literal("paypal/payment.capture.completed"),
  data: z.object({
    orderId: z.string(),
    captureId: z.string(),
    packId: z.string(),
  }),
});

export const paypalPaymentRefundedEventSchema = z.object({
  name: z.literal("paypal/payment.capture.refunded"),
  data: z.object({
    captureId: z.string(),
    refundId: z.string(),
  }),
});

export const clerkUserCreatedEventSchema = z.object({
  name: z.literal("clerk/user.created"),
  data: z.object({
    userId: z.string(),
    email: z.string().email(),
  }),
});

export const userDiscordConnectedEventSchema = z.object({
  name: z.literal("user/discord.connected"),
  data: z.object({
    clerkId: z.string(),
    discordId: z.string(),
  }),
});

export const sessionCompletedEventSchema = z.object({
  name: z.literal("session/completed"),
  data: z.object({
    sessionId: z.string().uuid(),
    sessionPackId: z.string().uuid(),
    userId: z.string(), // Clerk user ID
  }),
});

export const sessionScheduledEventSchema = z.object({
  name: z.literal("session/scheduled"),
  data: z.object({
    sessionId: z.string().uuid(),
    sessionPackId: z.string().uuid(),
    scheduledAt: z.coerce.date(),
  }),
});

export const packExpirationCheckEventSchema = z.object({
  name: z.literal("pack/expiration-check"),
  data: z.object({
    packId: z.string(), // Convex ID
  }),
});

export const sessionRenewalReminderEventSchema = z.object({
  name: z.literal("session/renewal-reminder"),
  data: z.object({
    sessionPackId: z.string(), // Convex ID
    userId: z.string(),
    sessionNumber: z.number().int().min(1).max(4),
    remainingSessions: z.number().int().min(0),
    gracePeriodEndsAt: z.coerce.date().optional(),
  }),
});

export const notificationSendEventSchema = z.object({
  name: z.literal("notification/send"),
  data: z.object({
    type: z.enum([
      "renewal_reminder",
      "final_renewal_reminder",
      "grace_period_final_warning",
    ]),
    userId: z.string(),
    sessionPackId: z.string().uuid(),
    message: z.string(),
    sessionNumber: z.number().int().min(1).max(4).optional(),
    gracePeriodEndsAt: z.coerce.date().optional(),
  }),
});

export const inventoryChangedEventSchema = z.object({
  name: z.literal("inventory/changed"),
  data: z.object({
    instructorSlug: z.string(),
    type: z.enum(["one-on-one", "group"]),
    previousInventory: z.number().int().min(0),
    newInventory: z.number().int().min(-1),
    quantity: z.number().int().positive(),
  }),
});

export const sessionBookingEmailEventSchema = z.object({
  name: z.literal("session/booking-email"),
  data: z.object({
    type: z.enum([
      "booking_confirmation_student",
      "booking_notification_instructor",
    ]),
    sessionId: z.string(), // Convex ID
    sessionPackId: z.string(), // Convex ID
    studentId: z.string(),
    instructorId: z.string(), // Convex ID
    scheduledAt: z.coerce.date(),
  }),
});

export const sessionReminderEmailEventSchema = z.object({
  name: z.literal("session/reminder-email"),
  data: z.object({
    type: z.enum(["24h_before", "1h_before"]),
    sessionId: z.string(), // Convex ID
    sessionPackId: z.string(), // Convex ID
    studentId: z.string(),
    instructorId: z.string(), // Convex ID
    scheduledAt: z.coerce.date(),
  }),
});

export const sessionCancelledEmailEventSchema = z.object({
  name: z.literal("session/cancelled-email"),
  data: z.object({
    sessionId: z.string(), // Convex ID
    sessionPackId: z.string(), // Convex ID
    studentId: z.string(),
    instructorId: z.string(), // Convex ID
    scheduledAt: z.coerce.date(),
    cancelledBy: z.enum(["instructor", "student"]),
  }),
});

// Type exports
export type PurchaseMentorshipEvent = z.infer<typeof purchaseMentorshipEventSchema>;
export type StripeCheckoutCompletedEvent = z.infer<typeof stripeCheckoutCompletedEventSchema>;
export type StripeChargeRefundedEvent = z.infer<typeof stripeChargeRefundedEventSchema>;
export type PaypalPaymentCompletedEvent = z.infer<typeof paypalPaymentCompletedEventSchema>;
export type PaypalPaymentRefundedEvent = z.infer<typeof paypalPaymentRefundedEventSchema>;
export type ClerkUserCreatedEvent = z.infer<typeof clerkUserCreatedEventSchema>;
export type UserDiscordConnectedEvent = z.infer<typeof userDiscordConnectedEventSchema>;
export type SessionCompletedEvent = z.infer<typeof sessionCompletedEventSchema>;
export type SessionScheduledEvent = z.infer<typeof sessionScheduledEventSchema>;
export type PackExpirationCheckEvent = z.infer<typeof packExpirationCheckEventSchema>;
export type SessionRenewalReminderEvent = z.infer<typeof sessionRenewalReminderEventSchema>;
export type NotificationSendEvent = z.infer<typeof notificationSendEventSchema>;
export type InventoryChangedEvent = z.infer<typeof inventoryChangedEventSchema>;
export type SessionBookingEmailEvent = z.infer<typeof sessionBookingEmailEventSchema>;
export type SessionReminderEmailEvent = z.infer<typeof sessionReminderEmailEventSchema>;
export type SessionCancelledEmailEvent = z.infer<typeof sessionCancelledEmailEventSchema>;

export type InngestEvent =
  | PurchaseMentorshipEvent
  | StripeCheckoutCompletedEvent
  | StripeChargeRefundedEvent
  | PaypalPaymentCompletedEvent
  | PaypalPaymentRefundedEvent
  | ClerkUserCreatedEvent
  | UserDiscordConnectedEvent
  | SessionCompletedEvent
  | SessionScheduledEvent
  | PackExpirationCheckEvent
  | SessionRenewalReminderEvent
  | NotificationSendEvent
  | InventoryChangedEvent
  | SessionBookingEmailEvent
  | SessionReminderEmailEvent
  | SessionCancelledEmailEvent;

// ============================================================
// Phase 4: Event-Driven Sync Events (Convex → SQL)
// ============================================================

export const paymentCreatedEventSchema = z.object({
  name: z.literal("data.sync/payment.created"),
  data: z.object({
    id: z.string(),
    orderId: z.string(),
    provider: z.enum(["stripe", "paypal"]),
    providerPaymentId: z.string(),
    amount: z.string(),
    currency: z.string(),
    status: z.enum(["pending", "completed", "refunded", "failed"]),
    refundedAmount: z.string().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export const paymentUpdatedEventSchema = z.object({
  name: z.literal("data.sync/payment.updated"),
  data: z.object({
    id: z.string(),
    orderId: z.string(),
    status: z.enum(["pending", "completed", "refunded", "failed"]),
    refundedAmount: z.string().nullable().optional(),
    updatedAt: z.number(),
  }),
});

export const orderCreatedEventSchema = z.object({
  name: z.literal("data.sync/order.created"),
  data: z.object({
    id: z.string(),
    userId: z.string(),
    status: z.enum(["pending", "paid", "refunded", "failed", "canceled"]),
    provider: z.enum(["stripe", "paypal"]),
    totalAmount: z.string(),
    currency: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export const orderUpdatedEventSchema = z.object({
  name: z.literal("data.sync/order.updated"),
  data: z.object({
    id: z.string(),
    status: z.enum(["pending", "paid", "refunded", "failed", "canceled"]),
    updatedAt: z.number(),
  }),
});

export const sessionPackCreatedEventSchema = z.object({
  name: z.literal("data.sync/sessionPack.created"),
  data: z.object({
    id: z.string(),
    userId: z.string(),
    instructorId: z.string(),
    totalSessions: z.number(),
    remainingSessions: z.number(),
    purchasedAt: z.number(),
    expiresAt: z.number().nullable().optional(),
    status: z.enum(["active", "depleted", "expired", "refunded"]),
    paymentId: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export const sessionPackUpdatedEventSchema = z.object({
  name: z.literal("data.sync/sessionPack.updated"),
  data: z.object({
    id: z.string(),
    remainingSessions: z.number().optional(),
    status: z.enum(["active", "depleted", "expired", "refunded"]).optional(),
    updatedAt: z.number(),
  }),
});

export const seatReservationCreatedEventSchema = z.object({
  name: z.literal("data.sync/seatReservation.created"),
  data: z.object({
    id: z.string(),
    userId: z.string(),
    instructorId: z.string(),
    sessionPackId: z.string(),
    status: z.enum(["active", "grace", "released"]),
    seatExpiresAt: z.number().nullable().optional(),
    gracePeriodEndsAt: z.number().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export const seatReservationUpdatedEventSchema = z.object({
  name: z.literal("data.sync/seatReservation.updated"),
  data: z.object({
    id: z.string(),
    status: z.enum(["active", "grace", "released"]).optional(),
    seatExpiresAt: z.number().nullable().optional(),
    gracePeriodEndsAt: z.number().nullable().optional(),
    updatedAt: z.number(),
  }),
});

// Sync event type exports
export type PaymentCreatedEvent = z.infer<typeof paymentCreatedEventSchema>;
export type PaymentUpdatedEvent = z.infer<typeof paymentUpdatedEventSchema>;
export type OrderCreatedEvent = z.infer<typeof orderCreatedEventSchema>;
export type OrderUpdatedEvent = z.infer<typeof orderUpdatedEventSchema>;
export type SessionPackCreatedEvent = z.infer<typeof sessionPackCreatedEventSchema>;
export type SessionPackUpdatedEvent = z.infer<typeof sessionPackUpdatedEventSchema>;
export type SeatReservationCreatedEvent = z.infer<typeof seatReservationCreatedEventSchema>;
export type SeatReservationUpdatedEvent = z.infer<typeof seatReservationUpdatedEventSchema>;

export type SyncEvent =
  | PaymentCreatedEvent
  | PaymentUpdatedEvent
  | OrderCreatedEvent
  | OrderUpdatedEvent
  | SessionPackCreatedEvent
  | SessionPackUpdatedEvent
  | SeatReservationCreatedEvent
  | SeatReservationUpdatedEvent;
