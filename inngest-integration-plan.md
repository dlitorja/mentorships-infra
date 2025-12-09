# Inngest Integration Plan for Mentorship Platform

## Executive Summary

**Inngest** is a serverless event-driven workflow platform that would significantly improve our mentorship platform by:
- Replacing manual scheduled job infrastructure
- Providing reliable webhook processing with automatic retries
- Enabling complex multi-step workflows (onboarding, renewals, seat management)
- Simplifying event-driven architecture

## Current Architecture Analysis

### What We Have Now

1. **Direct Webhook Processing** (`apps/web/app/api/webhooks/stripe/route.ts`)
   - Stripe webhooks handled synchronously in API routes
   - Manual retry logic with exponential backoff
   - All processing happens in single request handler

2. **No Background Job System**
   - Scheduled tasks (renewal reminders, seat expiration) not yet implemented
   - Discord bot (`apps/bot/`) is separate app, no orchestration layer
   - No centralized event processing

3. **Manual Workflow Management**
   - Onboarding flow would require manual coordination
   - No built-in waiting/retry mechanisms
   - No visibility into workflow state

### What Inngest Would Add

1. **Event-Driven Architecture**
   - All events (purchases, user creation, Discord OAuth) become Inngest events
   - Automatic retries with exponential backoff
   - Built-in idempotency
   - Visual workflow debugging

2. **Scheduled Tasks Made Easy**
   - Renewal reminders (session 3, session 4, grace period warnings)
   - Seat expiration checks
   - Pack expiration handling
   - No need for cron jobs or separate scheduler

3. **Complex Workflows**
   - Multi-step onboarding (purchase → wait for Discord → grant access)
   - Grace period management with automatic seat release
   - Email follow-ups with delays

## Integration Points

### 1. Payment Webhooks → Inngest Events

**Current**: Direct webhook handler in `apps/web/app/api/webhooks/stripe/route.ts`

**With Inngest**:
```typescript
// apps/web/app/api/webhooks/stripe/route.ts
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  
  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // Verify signature (CRITICAL for security!)
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  
  // Send to Inngest instead of processing directly
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await inngest.send({
      name: "stripe/checkout.session.completed",
      data: { 
        sessionId: session.id, 
        orderId: session.metadata?.order_id,
        userId: session.metadata?.user_id,
        packId: session.metadata?.pack_id
      }
    });
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    await inngest.send({
      name: "stripe/charge.refunded",
      data: {
        chargeId: charge.id,
        paymentIntentId: charge.payment_intent as string,
      }
    });
  }
  
  return NextResponse.json({ received: true });
}
```

**PayPal Webhook** (needs to be created):
```typescript
// apps/web/app/api/webhooks/paypal/route.ts
export async function POST(req: NextRequest) {
  // Verify PayPal webhook signature
  const verified = await verifyPayPalWebhook(req);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  
  const event = await req.json();
  
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    await inngest.send({
      name: "paypal/payment.capture.completed",
      data: {
        orderId: event.resource.supplementary_data?.order_id,
        captureId: event.resource.id,
        userId: event.resource.custom_id?.split(":")[1], // Extract from custom_id
        packId: event.resource.custom_id?.split(":")[0],
      }
    });
  }
  
  return NextResponse.json({ received: true });
}
```

**Benefits**:
- Webhook handler becomes lightweight (just signature verification + event dispatch)
- Processing happens asynchronously with automatic retries
- Failed processing doesn't block webhook response

### 2. Onboarding Workflow

**From Inngest Plan**: Purchase → Clerk user lookup → Discord OAuth email → Wait → Grant access

**Implementation**:
```typescript
// apps/web/inngest/functions/onboarding.ts
inngest.createFunction(
  { id: "onboarding-flow" },
  { event: "purchase/mentorship" },
  async ({ event, step }) => {
    // Step 1: Get Clerk user (use clerkId from event, not userId)
    const user = await step.run("get-clerk-user", () => 
      clerk.users.getUser(event.data.clerkId) // Fixed: use clerkId
    );
    
    // Step 2: Send Discord OAuth email
    await step.run("send-discord-email", () => 
      resend.emails.send({
        to: user.emailAddresses[0].emailAddress,
        template: "discord-oauth",
        data: { 
          oauthLink: `${process.env.NEXT_PUBLIC_URL}/api/auth/discord?clerkId=${user.id}` 
        }
      })
    );
    
    // Step 3: Wait for Discord connection (48h timeout)
    const discordConnected = await step.waitForEvent("user/discord.connected", {
      timeout: "48h",
      match: "data.clerkId"
    });
    
    if (discordConnected) {
      // Step 4: Grant dashboard access
      await step.run("grant-dashboard-access", () => 
        grantAccess(user.id)
      );
    } else {
      // Step 5: Send follow-up email
      await step.run("send-followup", () => 
        resend.emails.send({ 
          to: user.emailAddresses[0].emailAddress,
          template: "discord-reminder" 
        })
      );
    }
  }
);
```

### 3. Scheduled Tasks (Renewal Reminders, Seat Expiration)

**Current**: Not implemented

**With Inngest**:
```typescript
// apps/web/inngest/functions/session-reminders.ts

// Triggered when session completes
inngest.createFunction(
  { id: "session-completed-handler" },
  { event: "session/completed" },
  async ({ event, step }) => {
    const { sessionId, sessionPackId, userId } = event.data;
    
    // Calculate session number from completed sessions count
    const sessionNumber = await step.run("calculate-session-number", async () => {
      const completedCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(sessions)
        .where(
          and(
            eq(sessions.sessionPackId, sessionPackId),
            eq(sessions.status, "completed")
          )
        );
      return completedCount[0].count;
    });
    
    // Update remaining sessions
    await step.run("update-sessions", async () => {
      const pack = await getSessionPack(sessionPackId);
      const newRemaining = pack.remainingSessions - 1;
      
      await db
        .update(sessionPacks)
        .set({ 
          remainingSessions: newRemaining,
          status: newRemaining === 0 ? "depleted" : pack.status
        })
        .where(eq(sessionPacks.id, sessionPackId));
    });
    
    // Session 3: Send renewal reminder
    if (sessionNumber === 3) {
      await step.run("send-renewal-reminder", () => 
        sendRenewalReminder(userId)
      );
    }
    
    // Session 4: Lock bookings + start grace period
    if (sessionNumber === 4) {
      // Update seat reservation to grace status
      await step.run("start-grace-period", async () => {
        const gracePeriodEndsAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h
        
        await db
          .update(seatReservations)
          .set({
            status: "grace",
            gracePeriodEndsAt: gracePeriodEndsAt,
            updatedAt: new Date()
          })
          .where(eq(seatReservations.sessionPackId, sessionPackId));
      });
      
      // Schedule grace period expiration check
      await step.sleep("grace-period", "72h");
      
      await step.run("check-grace-expiration", async () => {
        const pack = await getSessionPack(sessionPackId);
        const seat = await getSeatByPackId(sessionPackId);
        
        // Check if pack was renewed (new pack exists for same user/mentor)
        const renewed = await checkPackRenewed(userId, pack.mentorId);
        
        if (pack.remainingSessions === 0 && !renewed) {
          await releaseSeat(sessionPackId);
          await sendSeatReleasedNotification(userId);
        }
      });
    }
  }
);
```

### 4. Pack Expiration

```typescript
// apps/web/inngest/functions/pack-expiration.ts
inngest.createFunction(
  { id: "pack-expiration-check" },
  { cron: "0 0 * * *" }, // Daily at midnight
  async ({ step }) => {
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
    
    for (const pack of expiredPacks) {
      await step.run(`expire-pack-${pack.id}`, async () => {
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
          await releaseSeat(pack.id);
          await db
            .update(sessionPacks)
            .set({ status: "expired" })
            .where(eq(sessionPacks.id, pack.id));
          await sendExpirationNotification(pack.userId);
        } else {
          // Has scheduled sessions: block new bookings, allow existing to complete
          await db
            .update(sessionPacks)
            .set({ status: "expired" }) // Status change blocks new bookings
            .where(eq(sessionPacks.id, pack.id));
          
          // Schedule check after last session's scheduled time
          const lastSessionTime = scheduledSessions
            .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0]
            .scheduledAt;
          
          await inngest.send({
            name: "pack/expiration-check",
            data: { packId: pack.id },
            ts: Math.floor(lastSessionTime.getTime() / 1000)
          });
        }
      });
    }
  }
);
```

## File Structure

```
apps/web/
├── app/api/
│   ├── inngest/
│   │   └── route.ts              # Inngest webhook endpoint
│   ├── webhooks/
│   │   └── stripe/
│   │       └── route.ts          # Simplified: verify + send to Inngest
│   └── auth/
│       └── discord/
│           └── callback/
│               └── route.ts      # Send user/discord.connected event
├── inngest/
│   ├── client.ts                 # Inngest client initialization
│   ├── functions/
│   │   ├── onboarding.ts        # Purchase → Discord → Access workflow
│   │   ├── payments.ts          # Payment processing (from webhooks)
│   │   ├── session-reminders.ts  # Renewal reminders, grace period
│   │   ├── pack-expiration.ts    # Daily expiration checks
│   │   └── seat-management.ts   # Seat release logic
│   └── types.ts                  # Event type definitions
└── packages/
    └── messaging/                # Email/Discord notification helpers
```

## Event Schema

```typescript
// apps/web/inngest/types.ts
import { z } from "zod";

// Event schemas with Zod validation
export const purchaseMentorshipEventSchema = z.object({
  name: z.literal("purchase/mentorship"),
  data: z.object({
    orderId: z.string().uuid(),
    clerkId: z.string(), // Fixed: use clerkId, not userId
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
    userId: z.string(), // Clerk user ID
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
    // Note: sessionNumber is calculated, not passed in event
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

// Union type for all events
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

## Migration Strategy

### Phase 1: Setup (Week 1)
1. Install Inngest SDK: `pnpm add inngest`
2. Create `/api/inngest/route.ts` endpoint
3. Set up Inngest dev server: `npx inngest-cli@latest dev`
4. Configure Inngest in Vercel (production)
5. **Add environment variables** (see Environment Variables section)
6. **Create event type definitions** with Zod validation
7. **Set up error handling** and logging infrastructure

### Phase 2: Webhook Migration (Week 1-2)
1. **Create PayPal webhook handler** (if not exists)
2. Move Stripe webhook processing to Inngest function
3. Keep existing webhook handler but make it lightweight (verify + dispatch)
4. **Add dual-write** (keep existing logic as fallback during migration)
5. Test with Stripe test webhooks
6. **Add idempotency keys** to prevent duplicate processing
7. Monitor for any regressions

### Phase 3: Scheduled Tasks (Week 2-3)
1. Implement pack expiration daily cron
2. Implement session completion handlers
3. Add renewal reminder logic
4. Add grace period management

### Phase 4: Onboarding Workflow (Week 3-4)
1. Implement purchase → Discord OAuth flow
2. Add email templates for Discord connection
3. Add dashboard access granting logic
4. Test full onboarding flow

### Phase 5: Polish & Monitoring (Week 4)
1. Add error handling and alerts
2. Set up Inngest dashboard monitoring
3. Document all workflows
4. Performance testing

## Benefits Summary

### Reliability
- ✅ Automatic retries with exponential backoff
- ✅ Built-in idempotency
- ✅ Visual debugging in Inngest dashboard
- ✅ No lost events (Inngest queues everything)

### Developer Experience
- ✅ Type-safe event definitions
- ✅ Step-by-step function execution (easy to debug)
- ✅ No need to manage cron jobs or queues
- ✅ Local development with `inngest dev`

### Scalability
- ✅ Serverless (no infrastructure to manage)
- ✅ Handles high event volumes automatically
- ✅ Built-in rate limiting
- ✅ Cost-effective (pay per execution)

### Maintainability
- ✅ All workflows in one place (`inngest/functions/`)
- ✅ Clear event flow (easy to understand)
- ✅ Easy to add new workflows
- ✅ Version control for all workflows

## Cost Considerations

**Inngest Pricing** (as of 2024):
- Free tier: 25,000 function runs/month
- Pro: $20/month for 100,000 runs
- Enterprise: Custom pricing

**Estimated Usage**:
- Webhook events: ~100-500/month (depends on sales)
- Scheduled tasks: ~30/day = ~900/month (pack expiration checks)
- Session events: ~50-200/month
- **Total: ~1,000-1,600 runs/month** → Well within free tier!

## Comparison: Inngest vs Alternatives

### vs Vercel Cron Jobs
- ✅ Inngest: Visual debugging, retries, event-driven
- ❌ Cron: No retries, harder to debug, manual setup

### vs Queue Systems (BullMQ, Bull)
- ✅ Inngest: Serverless, no infrastructure, built-in UI
- ❌ Queue: Need Redis, manage workers, more complex

### vs Direct API Routes
- ✅ Inngest: Automatic retries, scheduled tasks, workflows
- ❌ Direct: Manual retry logic, no scheduling, harder to orchestrate

## Next Steps

1. **Review this plan** with team
2. **Set up Inngest account** and get API keys
3. **Create initial Inngest endpoint** (`/api/inngest/route.ts`)
4. **Migrate one webhook** as proof of concept (Stripe checkout)
5. **Iterate** based on learnings

## Environment Variables

**Required for Inngest**:
```bash
# .env.local (development)
INNGEST_EVENT_KEY=your_event_key
INNGEST_SIGNING_KEY=your_signing_key
INNGEST_APP_ID=your_app_id

# For local dev server
INNGEST_DEV_URL=http://localhost:3000/api/inngest

# Production (Vercel)
# Set these in Vercel dashboard under Project Settings → Environment Variables
```

**Get API Keys**:
1. Sign up at https://www.inngest.com
2. Create a new app
3. Copy Event Key, Signing Key, and App ID from dashboard

## Error Handling Strategy

**All Inngest functions should include**:
```typescript
try {
  // Function logic
} catch (error) {
  // Log to Axiom
  await step.run("log-error", () => 
    axiom.ingest("inngest-errors", { error, event, step })
  );
  
  // Send to Better Stack
  await step.run("report-error", () => 
    betterStack.reportError(error, { 
      context: { event, step },
      severity: "error"
    })
  );
  
  // Re-throw to let Inngest retry
  throw error;
}
```

**Critical failures** (payment processing, seat release) should also:
- Send email/Slack alert to admin
- Log to separate critical errors table
- Have manual intervention process documented

## Questions to Answer

1. ✅ **Keep existing webhook handlers as fallback?** → Yes, during migration phase (dual-write)
2. **Should we migrate Discord bot events to Inngest too?** → Consider after core workflows are stable
3. ✅ **How do we handle Inngest failures?** → See Error Handling Strategy above
4. **Should we use Inngest for all async operations?** → Start with critical workflows, expand gradually

## References

- [Inngest Docs](https://www.inngest.com/docs)
- [Clerk Integration Guide](https://www.inngest.com/docs/guides/clerk-webhook-events)
- [Resend Integration Guide](https://www.inngest.com/docs/guides/resend-webhook-events)
- Original plan: `mentorships-onboarding-inngest.md`

