# Inngest Integration Plan - Review & Recommendations

## Executive Summary

✅ **Overall Assessment**: The plan is **solid and well-structured**. Inngest is an excellent fit for this project. However, there are several important gaps and recommendations that need to be addressed before implementation.

## ✅ Strengths

1. **Clear Architecture Vision**: The plan correctly identifies that Inngest solves real problems (webhook retries, scheduled tasks, complex workflows)
2. **Phased Migration**: The 4-week phased approach is realistic and low-risk
3. **Cost Analysis**: Free tier is sufficient for MVP phase
4. **Event Schema**: Well-defined event types with TypeScript
5. **Alignment with Original Plan**: Matches the onboarding document's vision

## ⚠️ Critical Issues & Gaps

### 1. Database Schema Mismatches

**Issue**: The plan references fields that don't exist in the current schema.

**Found in Code**:
- ✅ `gracePeriodEndsAt` exists in `seatReservations` (line 23)
- ❌ `renewed` field doesn't exist in `sessionPacks` (referenced in line 161 of plan)
- ❌ `sessionNumber` not stored in database (referenced in line 279 of plan)

**Recommendation**:
```typescript
// Need to either:
// Option A: Calculate sessionNumber from completed sessions count
const sessionNumber = await getCompletedSessionsCount(sessionPackId) + 1;

// Option B: Add sessionNumber to sessions table
// Add to sessions schema:
sessionNumber: integer("session_number").notNull(),

// Option C: Track in a separate table or derive from order
```

**Action Required**: 
- Decide how to track session numbers (calculate vs store)
- Remove or fix references to non-existent `renewed` field
- Update plan to match actual schema

### 2. Onboarding Workflow Discrepancy

**Issue**: The original onboarding plan shows a different flow than the integration plan.

**Original Plan** (`mentorships-onboarding-inngest.md`):
```
purchase/mentorship → Clerk user lookup → Discord OAuth email 
→ Wait discord.connected → Grant dashboard access
```

**Integration Plan** (line 79-120):
- Same flow, but references `event.data.userId` which should be `event.data.clerkId` to match original
- Missing PayPal event handling (only Stripe shown)

**Recommendation**:
```typescript
// Fix event data structure to match:
{ event: "purchase/mentorship" },
async ({ event, step }) => {
  // Should use clerkId, not userId
  const user = await step.run("get-clerk-user", () => 
    clerk.users.getUser(event.data.clerkId) // Not userId
  );
}
```

### 3. Missing PayPal Integration

**Issue**: Plan shows Stripe webhook migration but doesn't address PayPal.

**Current State**: 
- Stripe webhook exists: `apps/web/app/api/webhooks/stripe/route.ts`
- PayPal webhook likely needs to be created

**Recommendation**: Add PayPal webhook handler that also sends to Inngest:
```typescript
// apps/web/app/api/webhooks/paypal/route.ts (needs to be created)
export async function POST(req: NextRequest) {
  // Verify PayPal webhook signature
  const event = await verifyPayPalWebhook(req);
  
  // Send to Inngest
  await inngest.send({
    name: "paypal/payment.capture.completed",
    data: { orderId, userId, packId }
  });
  
  return NextResponse.json({ received: true });
}
```

### 4. Session Completion Event Source

**Issue**: Plan shows `session/completed` event but doesn't specify where it's triggered.

**Current State**: No session completion handler exists yet.

**Recommendation**: Add explicit trigger points:
```typescript
// Option A: From video call end (Agora callback)
// apps/web/app/api/video/end/route.ts
export async function POST(req: NextRequest) {
  // ... mark session as completed in DB
  await inngest.send({
    name: "session/completed",
    data: { sessionId, sessionPackId, sessionNumber, userId }
  });
}

// Option B: From manual completion (mentor marks complete)
// apps/web/app/api/sessions/[id]/complete/route.ts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // ... update session status
  await inngest.send({
    name: "session/completed",
    data: { ... }
  });
}
```

### 5. Grace Period Logic Inconsistency

**Issue**: Plan shows grace period starts after session 4, but grace period logic is tied to seat reservations, not session packs.

**Current Schema**:
- `seatReservations.gracePeriodEndsAt` exists
- `sessionPacks` has no grace period tracking

**Recommendation**: Clarify the relationship:
```typescript
// When session 4 completes:
await step.run("start-grace-period", async () => {
  // Update seat reservation, not session pack
  await db.update(seatReservations)
    .set({
      status: "grace",
      gracePeriodEndsAt: new Date(Date.now() + 72 * 60 * 60 * 1000) // 72h
    })
    .where(eq(seatReservations.sessionPackId, sessionPackId));
});
```

### 6. Pack Expiration Logic Needs Refinement

**Issue**: Plan shows checking for scheduled sessions, but doesn't handle edge cases.

**Current Business Rules** (from TECH_DECISIONS.md):
- Pack expiration: scheduled sessions complete, new bookings blocked
- Seat release conditions: pack expires AND all scheduled sessions completed

**Recommendation**: Update pack expiration function:
```typescript
await step.run(`expire-pack-${pack.id}`, async () => {
  const scheduledSessions = await getScheduledSessions(pack.id);
  
  if (scheduledSessions.length === 0) {
    // No scheduled sessions: release seat immediately
    await releaseSeat(pack.id);
    await updateSessionPackStatus(pack.id, "expired");
    await sendExpirationNotification(pack.userId);
  } else {
    // Has scheduled sessions: block new bookings, allow existing to complete
    await blockNewBookings(pack.id);
    // Don't release seat yet - wait for all sessions to complete
    // Schedule another check after last session's scheduled time
    const lastSessionTime = scheduledSessions
      .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0]
      .scheduledAt;
    
    await inngest.send({
      name: "pack/expiration-check",
      data: { packId: pack.id },
      ts: lastSessionTime.getTime() / 1000 // Schedule for after last session
    });
  }
});
```

## 📋 Missing Components

### 1. Error Handling & Alerting

**Missing**: No error handling strategy for Inngest function failures.

**Recommendation**: Add to plan:
```typescript
// apps/web/inngest/functions/payments.ts
inngest.createFunction(
  { id: "process-payment" },
  { event: "stripe/checkout.session.completed" },
  async ({ event, step }) => {
    try {
      // ... payment processing
    } catch (error) {
      // Send to error tracking (Better Stack)
      await step.run("log-error", () => 
        betterStack.reportError(error, { event, step })
      );
      
      // Send alert (email/Slack)
      await step.run("send-alert", () => 
        sendCriticalAlert("Payment processing failed", { event, error })
      );
      
      throw error; // Let Inngest retry
    }
  }
);
```

### 2. Idempotency Keys

**Missing**: Plan mentions idempotency but doesn't show implementation.

**Recommendation**: Add idempotency to critical functions:
```typescript
await step.run("create-session-pack", {
  idempotencyKey: `pack-${orderId}`, // Prevent duplicates
}, () => createSessionPack(...));
```

### 3. Testing Strategy

**Missing**: No testing approach for Inngest functions.

**Recommendation**: Add to plan:
- Unit tests for individual steps
- Integration tests with Inngest test SDK
- Local testing with `inngest dev`
- Webhook replay testing

### 4. Monitoring & Observability

**Missing**: How to monitor Inngest functions in production.

**Recommendation**: Add to plan:
- Inngest dashboard for function execution
- Axiom logging for all events
- Better Stack for error tracking
- Custom metrics for business events (pack created, seat released, etc.)

## 🔧 Technical Recommendations

### 1. File Structure Alignment

**Current Plan Structure**:
```
apps/web/inngest/
├── functions/
│   ├── onboarding.ts
│   ├── payments.ts
│   ├── session-reminders.ts
│   ├── pack-expiration.ts
│   └── seat-management.ts
```

**Recommendation**: Consider grouping by domain:
```
apps/web/inngest/
├── functions/
│   ├── payments/
│   │   ├── stripe.ts
│   │   └── paypal.ts
│   ├── onboarding/
│   │   └── discord-flow.ts
│   ├── sessions/
│   │   ├── completion.ts
│   │   └── reminders.ts
│   └── packs/
│       ├── expiration.ts
│       └── grace-period.ts
```

### 2. Type Safety

**Recommendation**: Use Zod for runtime validation:
```typescript
// apps/web/inngest/types.ts
import { z } from "zod";

export const purchaseMentorshipEventSchema = z.object({
  name: z.literal("purchase/mentorship"),
  data: z.object({
    orderId: z.string().uuid(),
    userId: z.string(),
    packId: z.string().uuid(),
    provider: z.enum(["stripe", "paypal"]),
  }),
});

export type PurchaseMentorshipEvent = z.infer<typeof purchaseMentorshipEventSchema>;
```

### 3. Environment Variables

**Missing**: Required Inngest environment variables.

**Recommendation**: Add to plan:
```bash
# .env.local
INNGEST_EVENT_KEY=your_event_key
INNGEST_SIGNING_KEY=your_signing_key
INNGEST_APP_ID=your_app_id

# For local dev
INNGEST_DEV_URL=http://localhost:3000/api/inngest
```

### 4. Clerk Webhook Integration

**Missing**: Details on how Clerk webhooks forward to Inngest.

**Recommendation**: Add explicit setup:
```typescript
// apps/web/app/api/webhooks/clerk/route.ts
export async function POST(req: NextRequest) {
  const event = await clerk.webhooks.verify(...);
  
  // Forward to Inngest
  await inngest.send({
    name: "clerk/user.created",
    data: {
      userId: event.data.id,
      email: event.data.email_addresses[0].email_address,
    },
  });
  
  return NextResponse.json({ received: true });
}
```

## 📊 Migration Risk Assessment

### Low Risk ✅
- Setting up Inngest endpoint
- Creating event types
- Local development setup

### Medium Risk ⚠️
- Migrating Stripe webhook (needs careful testing)
- Implementing scheduled tasks (new functionality)
- Onboarding workflow (complex multi-step)

### High Risk 🔴
- Production deployment without thorough testing
- Removing existing webhook logic before Inngest is proven
- Grace period logic (critical business rule)

## 🎯 Recommended Implementation Order

### Phase 1: Foundation (Week 1) ✅
1. Install Inngest SDK
2. Create `/api/inngest/route.ts`
3. Set up local dev environment
4. Create event type definitions
5. **Add**: Environment variable documentation

### Phase 2: Non-Critical Workflows (Week 1-2) ✅
1. Implement pack expiration cron (low risk, new feature)
2. Add session completion handler (new feature)
3. **Add**: Error handling and logging
4. **Add**: Testing strategy

### Phase 3: Webhook Migration (Week 2-3) ⚠️
1. **Fix**: Add PayPal webhook handler
2. Create Inngest payment processing function
3. **Modify**: Keep existing webhook as fallback (dual-write)
4. Test extensively with Stripe test webhooks
5. **Add**: Monitoring and alerting
6. Gradually migrate traffic

### Phase 4: Onboarding Workflow (Week 3-4) ⚠️
1. **Fix**: Use `clerkId` instead of `userId` in events
2. Create Discord OAuth callback handler
3. Implement onboarding function
4. **Add**: Email templates
5. Test full flow end-to-end

### Phase 5: Advanced Features (Week 4+) 🔴
1. **Fix**: Grace period logic (tie to seat reservations)
2. **Fix**: Session number tracking
3. Implement renewal reminders
4. **Add**: Comprehensive error handling
5. Performance testing

## ✅ Action Items Before Implementation

1. **Schema Decisions**:
   - [ ] Decide how to track session numbers (calculate vs store)
   - [ ] Confirm if `renewed` field needed or remove from plan
   - [ ] Verify grace period logic matches business rules

2. **Code Fixes**:
   - [ ] Fix `userId` → `clerkId` in onboarding workflow
   - [ ] Add PayPal webhook handler
   - [ ] Add session completion trigger points
   - [ ] Update pack expiration logic for edge cases

3. **Missing Components**:
   - [ ] Add error handling strategy
   - [ ] Add idempotency keys
   - [ ] Add testing strategy
   - [ ] Add monitoring/observability plan
   - [ ] Add environment variables documentation

4. **Documentation**:
   - [ ] Document all event triggers
   - [ ] Document error handling approach
   - [ ] Document testing procedures
   - [ ] Document rollback plan

## 🎓 Questions to Resolve

1. **Session Numbering**: How do we determine session number? Count completed sessions + 1, or store in sessions table?
2. **Pack Renewal**: Is there a `renewed` field needed, or do we check if a new pack exists?
3. **Grace Period**: Should grace period be tracked on seat reservation or session pack?
4. **Onboarding**: Is the Discord OAuth flow required for all users, or only certain types?
5. **PayPal**: Do we need PayPal webhook handler now, or can it wait?
6. **Error Recovery**: What's the manual intervention process if Inngest functions fail?

## 📚 References

- Current webhook: `apps/web/app/api/webhooks/stripe/route.ts`
- Schema: `packages/db/src/schema/`
- Original plan: `mentorships-onboarding-inngest.md`
- Business rules: `TECH_DECISIONS.md`

---

**Review Date**: 2025-01-XX
**Reviewer**: AI Assistant
**Status**: ✅ Plan is solid, but needs fixes before implementation

