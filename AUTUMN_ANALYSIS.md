# Autumn Billing Platform Analysis

## Executive Summary

**Recommendation: ❌ DO NOT USE AUTUMN for this project**

Autumn is designed for **subscription-based SaaS products** with recurring billing, plan switching, and usage metering. Your mentorship platform uses **one-time payments only** with a session pack model, making Autumn a poor fit.

---

## What is Autumn?

Autumn is an open-source billing infrastructure layer that sits between your server and Stripe. It's designed to:

- **Manage subscription state** (active, overdue, cancelled, etc.)
- **Handle plan switching** (upgrades, downgrades, scheduled changes)
- **Track usage limits** (monthly recurring limits, one-time grants, credits)
- **Support custom plans** and plan versioning
- **Eliminate webhook complexity** (they handle Stripe webhooks internally)

**Key Claim**: "No webhooks needed!" - Autumn handles all Stripe webhook processing internally.

---

## Your Current Architecture

### Business Model
- ✅ **One-time payments only** (no subscriptions)
- ✅ **Session packs** (4 sessions per pack)
- ✅ **No recurring billing**
- ✅ **No plan switching** (each purchase is independent)

### Current Stripe Integration
- ✅ Stripe Checkout for one-time payments
- ✅ Webhook handler (`/api/webhooks/stripe/route.ts`)
- ✅ Inngest processes webhook events asynchronously
- ✅ Well-architected with idempotency, retries, and error handling

### Current Flow
```
1. User clicks "Buy Pack"
2. Create order in database (status: pending)
3. Create Stripe Checkout session
4. User completes payment on Stripe
5. Stripe webhook → Your webhook handler
6. Webhook handler → Inngest event
7. Inngest function processes:
   - Update order to "paid"
   - Create payment record
   - Create session pack
   - Create seat reservation
   - Trigger onboarding
```

---

## Why Autumn Doesn't Fit

### 1. **Subscription-Focused Design**

Autumn's core features are built for subscriptions:
- **Plan management**: You don't have plans, you have one-time purchases
- **Subscription state**: You don't track subscription status
- **Plan switching**: Not applicable to your model
- **Recurring billing**: You explicitly avoid this

**Your model**: Each purchase is independent. No ongoing relationship to manage.

### 2. **Usage Limits vs. Session Packs**

Autumn tracks:
- Monthly recurring limits
- One-time grants
- Usage-based credits
- Spend limits

**Your model**: 
- Fixed session packs (4 sessions)
- Pack expiration (30-45 days)
- Seat reservations
- Remaining sessions counter

These are fundamentally different concepts. Autumn's usage tracking doesn't map to your session pack model.

### 3. **"No Webhooks" Claim**

Autumn's main selling point is eliminating webhook complexity. However:

- ✅ **You already have webhooks working well** with Inngest
- ✅ **Your webhook handler is simple** (just forwards to Inngest)
- ✅ **Inngest provides the value** (retries, idempotency, error handling)
- ❌ **Autumn would replace this** with their own system

**Trade-off**: You'd lose your current Inngest integration benefits for Autumn's subscription management (which you don't need).

### 4. **Inngest Compatibility**

**Current State**: 
- Stripe webhooks → Your handler → Inngest events → Inngest functions
- Full control over event processing
- Custom business logic in Inngest

**With Autumn**:
- Autumn handles Stripe webhooks internally
- You'd need to poll Autumn's API or use their webhooks (if they offer them)
- Less control over event processing
- Would need to bridge Autumn → Inngest manually

**Conclusion**: Autumn doesn't integrate with Inngest. You'd need to build a bridge layer, adding complexity without benefit.

---

## What Autumn Would Require

If you were to use Autumn, you'd need to:

1. **Model session packs as "plans"** (awkward fit)
2. **Treat each purchase as a subscription** (conceptually wrong)
3. **Use Autumn's checkout** instead of Stripe Checkout directly
4. **Poll Autumn's API** or use their webhooks to detect purchases
5. **Bridge Autumn events to Inngest** (manual integration)
6. **Lose direct Stripe integration** (Autumn abstracts it away)

**Result**: More complexity, less control, no real benefit.

---

## What You'd Gain (Theoretical)

If Autumn supported one-time payments well:

- ✅ Simplified billing logic (but you already have this)
- ✅ No webhook handling (but you already have this working)
- ✅ Usage tracking (but doesn't fit your model)
- ✅ Plan management (but you don't have plans)

**Reality**: These benefits don't apply to your use case.

---

## What You'd Lose

- ❌ Direct Stripe integration (you'd go through Autumn)
- ❌ Current Inngest webhook flow (you'd need to rebuild)
- ❌ Control over payment processing
- ❌ Simplicity (adding a layer you don't need)
- ❌ Flexibility (locked into Autumn's model)

---

## Alternative: Keep Current Architecture

Your current setup is **well-architected** for your use case:

### Strengths

1. **Simple webhook handler**: Just forwards to Inngest
2. **Inngest handles complexity**: Retries, idempotency, error handling
3. **Direct Stripe integration**: Full control, no abstraction layer
4. **One-time payments**: Perfect fit for your business model
5. **Type-safe**: Proper TypeScript throughout
6. **Tested**: You have test files for Stripe integration

### Current Flow is Clean

```typescript
// Webhook handler (simple)
Stripe webhook → Verify signature → Send to Inngest → Done

// Inngest function (handles complexity)
Inngest event → Process payment → Create pack → Create seat → Done
```

This is exactly what you need. No additional abstraction required.

---

## When Autumn Would Make Sense

Autumn would be valuable if you had:

- ✅ **Recurring subscriptions** (monthly/yearly plans)
- ✅ **Plan switching** (upgrades, downgrades)
- ✅ **Usage-based billing** (per API call, per message, etc.)
- ✅ **Complex plan features** (feature flags tied to plans)
- ✅ **Multiple pricing tiers** with different limits

**You have none of these.** Your model is simpler and doesn't need Autumn's complexity.

---

## Recommendation

**Keep your current Stripe + Inngest architecture.**

### Reasons:

1. ✅ **Perfect fit**: Your current setup matches your business model
2. ✅ **Simple**: No unnecessary abstraction layers
3. ✅ **Flexible**: Full control over payment processing
4. ✅ **Working**: Already implemented and tested
5. ✅ **Inngest integration**: Leverages Inngest's strengths (retries, idempotency)
6. ✅ **Type-safe**: Proper TypeScript throughout

### What to Focus On Instead:

1. **PayPal integration** (you have Stripe, add PayPal as secondary)
2. **Refund handling** (already in progress)
3. **Error monitoring** (Axiom, Better Stack)
4. **Testing** (expand test coverage)

**Don't add complexity you don't need.** Autumn is a great tool for subscription-based SaaS, but it's the wrong tool for one-time payments.

---

## References

- [Autumn Documentation](https://docs.useautumn.com/welcome)
- Current Stripe integration: `apps/web/app/api/webhooks/stripe/route.ts`
- Current Inngest functions: `apps/web/inngest/functions/payments.ts`
- Business model: `mentorship-platform-plan.md`

---

## Conclusion

**Autumn is not a good fit for your mentorship platform.** It's designed for subscription-based SaaS products, while your platform uses one-time payments with session packs. Your current Stripe + Inngest architecture is simpler, more flexible, and perfectly suited to your needs.

**Recommendation: Continue with direct Stripe integration + Inngest processing.**

