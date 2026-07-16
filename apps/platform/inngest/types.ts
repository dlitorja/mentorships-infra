import { z } from "zod";
import { convexIdSchema } from "../lib/validators";

/**
 * Non-empty trimmed string schema for identifier fields.
 * Prevents empty or whitespace-only values from passing validation.
 */
const idString = () => z.string().trim().min(1);

// Event schemas with runtime validation.
//
// PR 5 (naming compliance): the canonical event name is `purchase/instructor`.
// The legacy `purchase/mentorship` event is owned by `apps/web`; this
// platform app does NOT register it as a trigger (would cause duplicate
// side effects in a shared Inngest namespace). The schema below is
// intentionally strict on the canonical name — keeps TypeScript's
// discriminated-union narrowing correct for InngestEvent and prevents new
// code from accidentally emitting the forbidden name. See
// PROJECT_STATUS.md → "Naming compliance — deprecated aliases" for the
// cleanup checklist.
export const purchaseInstructorEventSchema = z.object({
  name: z.literal("purchase/instructor"),
  data: z.object({
    orderId: idString(),
    clerkId: idString(), // Clerk user ID
    packId: idString(),
    provider: z.enum(["stripe", "paypal"]),
  }),
});

export const stripeCheckoutCompletedEventSchema = z.object({
  name: z.literal("stripe/checkout.session.completed"),
  data: z.object({
    sessionId: idString(),
    orderId: idString(),
    userId: idString(), // Clerk user ID from metadata
    packId: idString(),
    studentEmail: z.string().email().optional(),
  }),
});

export const stripeChargeRefundedEventSchema = z.object({
  name: z.literal("stripe/charge.refunded"),
  data: z.object({
    chargeId: idString(),
    paymentIntentId: idString(),
  }),
});

export const paypalPaymentCompletedEventSchema = z.object({
  name: z.literal("paypal/payment.capture.completed"),
  data: z.object({
    orderId: idString(),
    captureId: idString(),
    packId: idString(),
    studentEmail: z.string().email().optional(),
  }),
});

export const paypalPaymentRefundedEventSchema = z.object({
  name: z.literal("paypal/payment.capture.refunded"),
  data: z.object({
    captureId: idString(),
    refundId: idString(),
  }),
});

export const clerkUserCreatedEventSchema = z.object({
  name: z.literal("clerk/user.created"),
  data: z.object({
    userId: idString(),
    email: z.string().email(),
  }),
});

export const userDiscordConnectedEventSchema = z.object({
  name: z.literal("user/discord.connected"),
  data: z.object({
    clerkId: idString(),
    discordId: idString(),
  }),
});

export const sessionCompletedEventSchema = z.object({
  name: z.literal("session/completed"),
  data: z.object({
    sessionId: idString(),
    sessionPackId: idString(),
    userId: idString(), // Clerk user ID
  }),
});

export const sessionScheduledEventSchema = z.object({
  name: z.literal("session/scheduled"),
  data: z.object({
    sessionId: idString(),
    sessionPackId: idString(),
    scheduledAt: z.coerce.date(),
  }),
});

export const packExpirationCheckEventSchema = z.object({
  name: z.literal("pack/expiration-check"),
  data: z.object({
    packId: idString(),
  }),
});

export const sessionRenewalReminderEventSchema = z.object({
  name: z.literal("session/renewal-reminder"),
  data: z.object({
    sessionPackId: idString(),
    userId: idString(),
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
    userId: idString(),
    sessionPackId: idString(),
    message: z.string(),
    sessionNumber: z.number().int().min(1).max(4).optional(),
    gracePeriodEndsAt: z.coerce.date().optional(),
  }),
});

export const inventoryChangedEventSchema = z.object({
  name: z.literal("inventory/changed"),
  data: z.object({
    instructorSlug: idString(),
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
    sessionId: idString(),
    sessionPackId: idString(),
    studentId: idString(),
    instructorId: idString(),
    scheduledAt: z.coerce.date(),
  }),
});

export const sessionReminderEmailEventSchema = z.object({
  name: z.literal("session/reminder-email"),
  data: z.object({
    type: z.enum(["24h_before", "1h_before"]),
    sessionId: idString(),
    sessionPackId: idString(),
    studentId: idString(),
    instructorId: idString(),
    scheduledAt: z.coerce.date(),
  }),
});

export const sessionCancelledEmailEventSchema = z.object({
  name: z.literal("session/cancelled-email"),
  data: z.object({
    sessionId: idString(),
    sessionPackId: idString(),
    studentId: idString(),
    instructorId: idString(),
    scheduledAt: z.coerce.date(),
    cancelledBy: z.enum(["instructor", "student"]),
  }),
});

// PR admin-onboarding #2: emitted by the commit API route after
// `adminOnboardStudent` succeeds. The stub flow in `onboarding.ts` reads
// this; PR 3's real Resend + Discord handler reads the same event. The
// `attemptCount` is part of the Inngest idempotency key so manual retries
// bypass any cached runs (see plan §Idempotency).
//
// `onboardingId` uses `convexIdSchema` so malformed IDs are rejected at
// the event boundary instead of reaching the Convex call site.
export const adminOnboardingCompletedEventSchema = z.object({
  name: z.literal("admin/onboarding.completed"),
  data: z.object({
    onboardingId: convexIdSchema,
    attemptCount: z.number().int().min(1),
  }),
});

// PR admin-onboarding #3: daily stale invite digest. Scheduled function
// reads DB state directly (no payload needed); the cron itself is the trigger.
export const adminOnboardingStaleDigestEventSchema = z.object({
  name: z.literal("admin/onboarding.stale-digest"),
  data: z.object({}), // empty — function scans DB for stale rows
});

// Type exports
export type PurchaseInstructorEvent = z.infer<typeof purchaseInstructorEventSchema>;
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
export type AdminOnboardingCompletedEvent = z.infer<typeof adminOnboardingCompletedEventSchema>;
export type AdminOnboardingStaleDigestEvent = z.infer<typeof adminOnboardingStaleDigestEventSchema>;

export type InngestEvent =
  | PurchaseInstructorEvent
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
  | SessionCancelledEmailEvent
  | AdminOnboardingCompletedEvent
  | AdminOnboardingStaleDigestEvent;

// ============================================================
// Phase 4: Event-Driven Sync Events (Convex → SQL)
// ============================================================

export const paymentCreatedEventSchema = z.object({
  name: z.literal("data.sync/payment.created"),
  data: z.object({
    id: idString(),
    orderId: idString(),
    provider: z.enum(["stripe", "paypal"]),
    providerPaymentId: idString(),
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
    id: idString(),
    orderId: idString(),
    status: z.enum(["pending", "completed", "refunded", "failed"]),
    refundedAmount: z.string().nullable().optional(),
    updatedAt: z.number(),
  }),
});

export const orderCreatedEventSchema = z.object({
  name: z.literal("data.sync/order.created"),
  data: z.object({
    id: idString(),
    userId: idString(),
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
    id: idString(),
    status: z.enum(["pending", "paid", "refunded", "failed", "canceled"]),
    updatedAt: z.number(),
  }),
});

export const sessionPackCreatedEventSchema = z.object({
  name: z.literal("data.sync/sessionPack.created"),
  data: z.object({
    id: idString(),
    userId: idString(),
    instructorId: idString(),
    totalSessions: z.number(),
    remainingSessions: z.number(),
    purchasedAt: z.number(),
    expiresAt: z.number().nullable().optional(),
    status: z.enum(["active", "depleted", "expired", "refunded"]),
    paymentId: idString(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export const sessionPackUpdatedEventSchema = z.object({
  name: z.literal("data.sync/sessionPack.updated"),
  data: z.object({
    id: idString(),
    remainingSessions: z.number().optional(),
    status: z.enum(["active", "depleted", "expired", "refunded"]).optional(),
    updatedAt: z.number(),
  }),
});

export const seatReservationCreatedEventSchema = z.object({
  name: z.literal("data.sync/seatReservation.created"),
  data: z.object({
    id: idString(),
    userId: idString(),
    instructorId: idString(),
    sessionPackId: idString(),
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
    id: idString(),
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