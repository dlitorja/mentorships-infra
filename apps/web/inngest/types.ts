import { z } from "zod";

// Event schemas with runtime validation
export const purchaseMentorshipEventSchema = z.object({
  name: z.literal("purchase/mentorship"),
  data: z.object({
    orderId: z.string().uuid(),
    clerkId: z.string(), // Clerk user ID
    packId: z.string().uuid(),
    provider: z.enum(["stripe", "paypal"]),
  }),
});

export const stripeCheckoutCompletedEventSchema = z.object({
  name: z.literal("stripe/checkout.session.completed"),
  data: z.object({
    sessionId: z.string(),
    orderId: z.string().uuid(),
    userId: z.string(), // Clerk user ID from metadata
    packId: z.string().uuid(),
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
    orderId: z.string().uuid(),
    captureId: z.string(),
    packId: z.string().uuid(),
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
    packId: z.string().uuid(),
  }),
});

export const sessionRenewalReminderEventSchema = z.object({
  name: z.literal("session/renewal-reminder"),
  data: z.object({
    sessionPackId: z.string().uuid(),
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
  | NotificationSendEvent;

