# Inngest Code Examples - Matching Actual Schema

This document contains corrected code examples that match the actual database schema and architecture.

## 1. Inngest Client Setup

```typescript
// apps/web/inngest/client.ts
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID || "mentorships-platform",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

// Export for use in functions
export { inngest };
```

## 2. Event Type Definitions with Zod

```typescript
// apps/web/inngest/types.ts
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
    userId: z.string(),
    packId: z.string().uuid(),
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

// Type exports
export type PurchaseMentorshipEvent = z.infer<typeof purchaseMentorshipEventSchema>;
export type StripeCheckoutCompletedEvent = z.infer<typeof stripeCheckoutCompletedEventSchema>;
export type StripeChargeRefundedEvent = z.infer<typeof stripeChargeRefundedEventSchema>;
export type PaypalPaymentCompletedEvent = z.infer<typeof paypalPaymentCompletedEventSchema>;
export type ClerkUserCreatedEvent = z.infer<typeof clerkUserCreatedEventSchema>;
export type UserDiscordConnectedEvent = z.infer<typeof userDiscordConnectedEventSchema>;
export type SessionCompletedEvent = z.infer<typeof sessionCompletedEventSchema>;
export type SessionScheduledEvent = z.infer<typeof sessionScheduledEventSchema>;
export type PackExpirationCheckEvent = z.infer<typeof packExpirationCheckEventSchema>;

export type InngestEvent =
  | PurchaseMentorshipEvent
  | StripeCheckoutCompletedEvent
  | StripeChargeRefundedEvent
  | PaypalPaymentCompletedEvent
  | ClerkUserCreatedEvent
  | UserDiscordConnectedEvent
  | SessionCompletedEvent
  | SessionScheduledEvent
  | PackExpirationCheckEvent;
```

## 3. Payment Processing Function

```typescript
// apps/web/inngest/functions/payments.ts
import { inngest } from "../client";
import { db } from "@/packages/db";
import { 
  orders, 
  payments, 
  sessionPacks, 
  seatReservations, 
  mentorshipProducts 
} from "@/packages/db/src/schema";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";
import { getOrderById } from "@/packages/db/src/lib/queries/orders";
import { getPaymentByProviderId } from "@/packages/db/src/lib/queries/payments";
import { getSessionPackByPaymentId } from "@/packages/db/src/lib/queries/sessionPacks";
import { releaseSeatByPackId } from "@/packages/db/src/lib/queries/sessionPacks";
import { updatePaymentStatus } from "@/packages/db/src/lib/queries/payments";
import { updateOrderStatus } from "@/packages/db/src/lib/queries/orders";
import { updateSessionPackStatus } from "@/packages/db/src/lib/queries/sessionPacks";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

// Process Stripe checkout completion
export const processStripeCheckout = inngest.createFunction(
  { 
    id: "process-stripe-checkout",
    name: "Process Stripe Checkout",
    retries: 3,
  },
  { event: "stripe/checkout.session.completed" },
  async ({ event, step }) => {
    const { sessionId, orderId, userId, packId } = event.data;

    // Step 1: Get order with retry (handle race conditions)
    const order = await step.run("get-order", async () => {
      // Retry logic for race condition if webhook fires before order creation
      let attempts = 0;
      let order = null;
      while (attempts < 3 && !order) {
        order = await getOrderById(orderId);
        if (!order) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempts + 1)));
          attempts++;
        }
      }
      if (!order) {
        throw new Error(`Order ${orderId} not found after retries`);
      }
      return order;
    });

    // Step 2: Check idempotency (prevent duplicate processing)
    if (order.status === "paid") {
      return { message: "Order already processed", orderId, alreadyProcessed: true };
    }

    // Step 3: Retrieve full Stripe session with discount details
    const fullSession = await step.run("get-stripe-session", async () => {
      return await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["total_details.breakdown.discounts"],
      });
    });

    // Step 4: Extract discount information
    const discountAmount = fullSession.total_details?.amount_discount
      ? (fullSession.total_details.amount_discount / 100).toString()
      : null;
    const originalAmount = fullSession.amount_subtotal
      ? (fullSession.amount_subtotal / 100).toString()
      : null;

    // Get discount code/coupon
    let discountCode: string | null = null;
    if (fullSession.total_details?.breakdown?.discounts && 
        fullSession.total_details.breakdown.discounts.length > 0) {
      const discount = fullSession.total_details.breakdown.discounts[0];
      if (discount.discount?.promotion_code) {
        discountCode = discount.discount.promotion_code.code || 
                       discount.discount.promotion_code.id || null;
      } else if (discount.discount?.coupon) {
        discountCode = discount.discount.coupon.id || 
                       discount.discount.coupon.name || null;
      }
    }

    // Step 5: Update order
    await step.run("update-order", {
      idempotencyKey: `order-${orderId}`,
    }, async () => {
      await db
        .update(orders)
        .set({
          status: "paid",
          totalAmount: (fullSession.amount_total! / 100).toString(),
          originalAmount: originalAmount || order.totalAmount,
          discountAmount: discountAmount,
          discountCode: discountCode,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
    });

    // Step 6: Create payment record
    const payment = await step.run("create-payment", {
      idempotencyKey: `payment-${sessionId}`,
    }, async () => {
      const [payment] = await db
        .insert(payments)
        .values({
          orderId: order.id,
          provider: "stripe",
          providerPaymentId: fullSession.payment_intent as string,
          amount: (fullSession.amount_total! / 100).toString(),
          currency: fullSession.currency!,
          status: "completed",
        })
        .returning();
      return payment;
    });

    // Step 7: Get product info
    const product = await step.run("get-product", async () => {
      const [product] = await db
        .select()
        .from(mentorshipProducts)
        .where(eq(mentorshipProducts.id, packId))
        .limit(1);
      
      if (!product) {
        throw new Error(`Product not found: ${packId}`);
      }
      return product;
    });

    // Step 8: Create session pack
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + product.validityDays);

    const sessionPack = await step.run("create-session-pack", {
      idempotencyKey: `pack-${orderId}`,
    }, async () => {
      const [pack] = await db
        .insert(sessionPacks)
        .values({
          userId,
          mentorId: product.mentorId,
          totalSessions: product.sessionsPerPack,
          remainingSessions: product.sessionsPerPack,
          expiresAt,
          status: "active",
          paymentId: payment.id,
        })
        .returning();
      return pack;
    });

    // Step 9: Create seat reservation
    await step.run("create-seat-reservation", {
      idempotencyKey: `seat-${sessionPack.id}`,
    }, async () => {
      await db.insert(seatReservations).values({
        mentorId: product.mentorId,
        userId,
        sessionPackId: sessionPack.id,
        seatExpiresAt: expiresAt,
        status: "active",
      });
    });

    // Step 10: Send purchase/mentorship event for onboarding
    await step.run("trigger-onboarding", async () => {
      await inngest.send({
        name: "purchase/mentorship",
        data: {
          orderId: order.id,
          clerkId: userId, // Clerk user ID
          packId: product.id,
          provider: "stripe",
        },
      });
    });

    return {
      success: true,
      orderId,
      sessionPackId: sessionPack.id,
      paymentId: payment.id,
    };
  }
);

// Process Stripe refund
export const processStripeRefund = inngest.createFunction(
  { 
    id: "process-stripe-refund",
    name: "Process Stripe Refund",
    retries: 3,
  },
  { event: "stripe/charge.refunded" },
  async ({ event, step }) => {
    const { paymentIntentId } = event.data;

    // Find payment by payment_intent
    const payment = await step.run("get-payment", async () => {
      return await getPaymentByProviderId("stripe", paymentIntentId);
    });

    if (!payment) {
      throw new Error(`Payment not found for payment intent: ${paymentIntentId}`);
    }

    // Find session pack
    const sessionPack = await step.run("get-session-pack", async () => {
      return await getSessionPackByPaymentId(payment.id);
    });

    if (!sessionPack) {
      throw new Error(`Session pack not found for payment: ${payment.id}`);
    }

    // Release the seat
    await step.run("release-seat", async () => {
      await releaseSeatByPackId(sessionPack.id);
    });

    // Mark pack as refunded
    await step.run("update-pack-status", async () => {
      await updateSessionPackStatus(sessionPack.id, "refunded", 0);
    });

    // Update payment status
    await step.run("update-payment-status", async () => {
      // Get refund amount from Stripe
      const charge = await stripe.charges.retrieve(event.data.chargeId);
      await updatePaymentStatus(
        payment.id,
        "refunded",
        (charge.amount_refunded / 100).toFixed(2)
      );
    });

    // Update order status
    await step.run("update-order-status", async () => {
      await updateOrderStatus(payment.orderId, "refunded");
    });

    return {
      success: true,
      sessionPackId: sessionPack.id,
      paymentId: payment.id,
    };
  }
);
```

## 4. Session Completion Handler

```typescript
// apps/web/inngest/functions/session-reminders.ts
import { inngest } from "../client";
import { db } from "@/packages/db";
import { sessions, sessionPacks, seatReservations } from "@/packages/db/src/schema";
import { eq, and, sql, count } from "drizzle-orm";
import { getSessionPackById } from "@/packages/db/src/lib/queries/sessionPacks";
import { sendRenewalReminder, sendSeatReleasedNotification } from "@/packages/messaging";

// Helper: Calculate session number from completed sessions count
async function calculateSessionNumber(sessionPackId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionPackId, sessionPackId),
        eq(sessions.status, "completed")
      )
    );
  return result[0]?.count || 0;
}

// Helper: Check if pack was renewed (new pack exists for same user/mentor)
async function checkPackRenewed(
  userId: string, 
  mentorId: string
): Promise<boolean> {
  const activePacks = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.mentorId, mentorId),
        eq(sessionPacks.status, "active")
      )
    );
  return activePacks.length > 0;
}

// Helper: Get seat reservation by pack ID
async function getSeatByPackId(sessionPackId: string) {
  const [seat] = await db
    .select()
    .from(seatReservations)
    .where(eq(seatReservations.sessionPackId, sessionPackId))
    .limit(1);
  return seat;
}

export const handleSessionCompleted = inngest.createFunction(
  {
    id: "session-completed-handler",
    name: "Handle Session Completion",
    retries: 3,
  },
  { event: "session/completed" },
  async ({ event, step }) => {
    const { sessionId, sessionPackId, userId } = event.data;

    // Step 1: Calculate session number from completed sessions count
    const sessionNumber = await step.run("calculate-session-number", async () => {
      return await calculateSessionNumber(sessionPackId);
    });

    // Step 2: Get current pack state
    const pack = await step.run("get-session-pack", async () => {
      return await getSessionPackById(sessionPackId);
    });

    if (!pack) {
      throw new Error(`Session pack not found: ${sessionPackId}`);
    }

    // Step 3: Update remaining sessions
    const newRemaining = pack.remainingSessions - 1;
    await step.run("update-sessions", {
      idempotencyKey: `update-sessions-${sessionPackId}-${sessionId}`,
    }, async () => {
      await db
        .update(sessionPacks)
        .set({
          remainingSessions: newRemaining,
          status: newRemaining === 0 ? "depleted" : pack.status,
          updatedAt: new Date(),
        })
        .where(eq(sessionPacks.id, sessionPackId));
    });

    // Step 4: Session 3: Send renewal reminder
    if (sessionNumber === 3) {
      await step.run("send-renewal-reminder", async () => {
        await sendRenewalReminder(userId, pack.mentorId);
      });
    }

    // Step 5: Session 4: Lock bookings + start grace period
    if (sessionNumber === 4) {
      // Update seat reservation to grace status
      await step.run("start-grace-period", {
        idempotencyKey: `grace-${sessionPackId}`,
      }, async () => {
        const gracePeriodEndsAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

        await db
          .update(seatReservations)
          .set({
            status: "grace",
            gracePeriodEndsAt: gracePeriodEndsAt,
            updatedAt: new Date(),
          })
          .where(eq(seatReservations.sessionPackId, sessionPackId));
      });

      // Schedule grace period expiration check
      await step.sleep("grace-period", "72h");

      await step.run("check-grace-expiration", async () => {
        const currentPack = await getSessionPackById(sessionPackId);
        const seat = await getSeatByPackId(sessionPackId);

        // Check if pack was renewed (new pack exists for same user/mentor)
        const renewed = await checkPackRenewed(userId, pack.mentorId);

        if (currentPack.remainingSessions === 0 && !renewed) {
          // Release seat
          await db
            .update(seatReservations)
            .set({
              status: "released",
              updatedAt: new Date(),
            })
            .where(eq(seatReservations.id, seat.id));

          // Send notification
          await sendSeatReleasedNotification(userId);
        }
      });
    }

    return {
      success: true,
      sessionPackId,
      sessionNumber,
      remainingSessions: newRemaining,
    };
  }
);
```

## 5. Pack Expiration Handler

```typescript
// apps/web/inngest/functions/pack-expiration.ts
import { inngest } from "../client";
import { db } from "@/packages/db";
import { sessionPacks, sessions, seatReservations } from "@/packages/db/src/schema";
import { eq, and, lte } from "drizzle-orm";
import { releaseSeatByPackId } from "@/packages/db/src/lib/queries/sessionPacks";
import { sendExpirationNotification } from "@/packages/messaging";

export const checkPackExpiration = inngest.createFunction(
  {
    id: "pack-expiration-check",
    name: "Check Pack Expiration",
    retries: 1, // Cron jobs don't need many retries
  },
  { cron: "0 0 * * *" }, // Daily at midnight UTC
  async ({ step }) => {
    // Step 1: Find expired packs
    const expiredPacks = await step.run("find-expired", async () => {
      const now = new Date();
      return await db
        .select()
        .from(sessionPacks)
        .where(
          and(
            lte(sessionPacks.expiresAt, now),
            eq(sessionPacks.status, "active")
          )
        );
    });

    // Step 2: Process each expired pack
    for (const pack of expiredPacks) {
      await step.run(`expire-pack-${pack.id}`, {
        idempotencyKey: `expire-${pack.id}-${pack.expiresAt.toISOString()}`,
      }, async () => {
        // Check if any scheduled sessions remain
        const scheduledSessions = await db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.sessionPackId, pack.id),
              eq(sessions.status, "scheduled")
            )
          );

        if (scheduledSessions.length === 0) {
          // No scheduled sessions: release seat immediately
          await releaseSeatByPackId(pack.id);
          
          await db
            .update(sessionPacks)
            .set({ 
              status: "expired",
              updatedAt: new Date(),
            })
            .where(eq(sessionPacks.id, pack.id));
          
          await sendExpirationNotification(pack.userId);
        } else {
          // Has scheduled sessions: block new bookings, allow existing to complete
          await db
            .update(sessionPacks)
            .set({ 
              status: "expired", // Status change blocks new bookings
              updatedAt: new Date(),
            })
            .where(eq(sessionPacks.id, pack.id));

          // Schedule check after last session's scheduled time
          const lastSessionTime = scheduledSessions
            .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0]
            .scheduledAt;

          await inngest.send({
            name: "pack/expiration-check",
            data: { packId: pack.id },
            ts: Math.floor(lastSessionTime.getTime() / 1000),
          });
        }
      });
    }

    return {
      success: true,
      expiredPacksProcessed: expiredPacks.length,
    };
  }
);

// Handle individual pack expiration check (triggered after last session)
export const handlePackExpirationCheck = inngest.createFunction(
  {
    id: "handle-pack-expiration-check",
    name: "Handle Pack Expiration Check",
  },
  { event: "pack/expiration-check" },
  async ({ event, step }) => {
    const { packId } = event.data;

    const pack = await step.run("get-pack", async () => {
      const [pack] = await db
        .select()
        .from(sessionPacks)
        .where(eq(sessionPacks.id, packId))
        .limit(1);
      return pack;
    });

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    // Check if any scheduled sessions still remain
    const scheduledSessions = await step.run("check-scheduled", async () => {
      return await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.sessionPackId, packId),
            eq(sessions.status, "scheduled")
          )
        );
    });

    if (scheduledSessions.length === 0 && pack.status === "expired") {
      // All sessions completed, release seat
      await step.run("release-seat", async () => {
        await releaseSeatByPackId(packId);
      });

      await step.run("send-notification", async () => {
        await sendExpirationNotification(pack.userId);
      });
    }

    return { success: true, packId };
  }
);
```

## 6. Onboarding Workflow

```typescript
// apps/web/inngest/functions/onboarding.ts
import { inngest } from "../client";
import { clerkClient } from "@clerk/nextjs/server";
import { resend } from "@/packages/messaging/resend";

export const onboardingFlow = inngest.createFunction(
  {
    id: "onboarding-flow",
    name: "Onboarding Flow",
    retries: 2,
  },
  { event: "purchase/mentorship" },
  async ({ event, step }) => {
    const { clerkId, packId } = event.data;

    // Step 1: Get Clerk user (use clerkId from event)
    const user = await step.run("get-clerk-user", async () => {
      return await clerkClient.users.getUser(clerkId);
    });

    if (!user) {
      throw new Error(`Clerk user not found: ${clerkId}`);
    }

    const email = user.emailAddresses[0]?.emailAddress;
    if (!email) {
      throw new Error(`No email found for user: ${clerkId}`);
    }

    // Step 2: Send Discord OAuth email
    await step.run("send-discord-email", async () => {
      const oauthLink = `${process.env.NEXT_PUBLIC_URL}/api/auth/discord?clerkId=${clerkId}`;
      
      await resend.emails.send({
        from: "Huckleberry <onboarding@huckleberry.com>",
        to: email,
        subject: "Connect Your Discord Account",
        template: "discord-oauth",
        data: {
          oauthLink,
          userName: user.firstName || "there",
        },
      });
    });

    // Step 3: Wait for Discord connection (48h timeout)
    const discordConnected = await step.waitForEvent("user/discord.connected", {
      timeout: "48h",
      match: "data.clerkId",
    });

    if (discordConnected) {
      // Step 4: Grant dashboard access
      await step.run("grant-dashboard-access", async () => {
        // TODO: Implement dashboard access granting logic
        // This might involve updating user roles, creating dashboard records, etc.
        console.log(`Granting dashboard access to ${clerkId}`);
      });
    } else {
      // Step 5: Send follow-up email
      await step.run("send-followup", async () => {
        await resend.emails.send({
          from: "Huckleberry <onboarding@huckleberry.com>",
          to: email,
          subject: "Reminder: Connect Your Discord Account",
          template: "discord-reminder",
          data: {
            oauthLink: `${process.env.NEXT_PUBLIC_URL}/api/auth/discord?clerkId=${clerkId}`,
            userName: user.firstName || "there",
          },
        });
      });
    }

    return {
      success: true,
      clerkId,
      discordConnected: !!discordConnected,
    };
  }
);
```

## 7. Inngest API Route

```typescript
// apps/web/app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { 
  processStripeCheckout,
  processStripeRefund 
} from "@/inngest/functions/payments";
import { handleSessionCompleted } from "@/inngest/functions/session-reminders";
import { 
  checkPackExpiration,
  handlePackExpirationCheck 
} from "@/inngest/functions/pack-expiration";
import { onboardingFlow } from "@/inngest/functions/onboarding";

// Export all functions for Inngest to serve
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processStripeCheckout,
    processStripeRefund,
    handleSessionCompleted,
    checkPackExpiration,
    handlePackExpirationCheck,
    onboardingFlow,
  ],
});
```

## 8. Updated Stripe Webhook Handler

```typescript
// apps/web/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { inngest } from "@/inngest/client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature (CRITICAL for security!)
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    // Send to Inngest for processing
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      await inngest.send({
        name: "stripe/checkout.session.completed",
        data: {
          sessionId: session.id,
          orderId: session.metadata?.order_id || "",
          userId: session.metadata?.user_id || "",
          packId: session.metadata?.pack_id || "",
        },
      });
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      
      await inngest.send({
        name: "stripe/charge.refunded",
        data: {
          chargeId: charge.id,
          paymentIntentId: charge.payment_intent as string,
        },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error sending event to Inngest:", error);
    // Still return 200 to Stripe (we'll retry via Inngest)
    return NextResponse.json({ received: true, error: "Event queued" });
  }
}

// Disable body parsing (Stripe needs raw body)
export const runtime = "nodejs";
```

## 9. Discord OAuth Callback

```typescript
// apps/web/app/api/auth/discord/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const clerkId = searchParams.get("clerkId");

  if (!code || !clerkId) {
    return NextResponse.redirect(
      new URL("/auth/error?message=missing_params", req.url)
    );
  }

  try {
    // Exchange code for Discord access token
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/auth/discord/callback`,
      }),
    });

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
      throw new Error("Failed to get Discord access token");
    }

    // Get Discord user info
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    const discordUser = await userResponse.json();

    // TODO: Store Discord connection in database
    // await storeDiscordConnection(clerkId, discordUser.id, tokens);

    // Send event to Inngest
    await inngest.send({
      name: "user/discord.connected",
      data: {
        clerkId,
        discordId: discordUser.id,
      },
    });

    // Redirect to success page
    return NextResponse.redirect(
      new URL("/auth/discord/success", req.url)
    );
  } catch (error) {
    console.error("Discord OAuth error:", error);
    return NextResponse.redirect(
      new URL("/auth/error?message=oauth_failed", req.url)
    );
  }
}
```

