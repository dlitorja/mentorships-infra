# Final Technical Decisions & Implementation Guide

## 1. Auth.js vs Clerk: Detailed Comparison

### Auth.js Benefits Over Clerk

**When Auth.js Makes Sense:**

1. **Cost at Scale**
   - **Clerk**: $25/month + $0.02 per MAU after 10k users
   - **Auth.js**: $0 (just hosting costs)
   - **Break-even**: At ~25k MAU, Clerk costs ~$300/month. Auth.js = ~$10-20/month (hosting)
   - **Savings**: ~$280/month at 25k users, ~$2,800/month at 100k users

2. **Full Control**
   - Customize auth flows exactly as needed
   - No vendor lock-in
   - Own your user data completely
   - Can implement custom features (e.g., custom MFA, special session handling)

3. **Data Privacy**
   - User data stays in your database
   - No third-party user management
   - Easier GDPR compliance (data doesn't leave your infrastructure)

4. **Learning & Flexibility**
   - Understand auth deeply
   - Can extend with custom providers
   - No API rate limits

**When Clerk Makes More Sense (Your Case):**

1. **Time to Market**
   - Clerk: 1-2 hours setup
   - Auth.js: 1-2 days setup + ongoing maintenance

2. **Features Out-of-Box**
   - Pre-built UI components
   - User management dashboard
   - Social logins (OAuth) pre-configured
   - MFA, passwordless, etc. ready

3. **Developer Experience**
   - Excellent TypeScript support
   - React hooks ready
   - Less code to write/maintain

4. **Your Requirements**
   - You want decoupled auth ✅ (Clerk does this)
   - You want to focus on mentorship features, not auth ✅
   - You're using AI-augmented development ✅ (less code = better)

### Recommendation: **Start with Clerk, Plan Migration Path**

**Strategy:**
1. **Phase 1 (MVP)**: Use Clerk - get to market fast
2. **Phase 2 (25k+ users)**: Evaluate cost vs. migration effort
3. **Phase 3 (if needed)**: Migrate to Auth.js when cost justifies it

**Migration Path:**
- Both use standard JWT tokens
- Both work with Supabase
- Migration is straightforward (export users, implement Auth.js, switch over)
- Can run both in parallel during transition

**Decision**: **Clerk for MVP** - Revisit at 20k users

---

## 2. Payment Implementation: Step-by-Step Hand-Holding Plan

### Phase 1: Stripe Setup (Week 1)

#### Day 1: Stripe Account & Basic Setup

**Step 1: Create Stripe Account**
```
1. Go to https://dashboard.stripe.com/register
2. Complete business verification
3. Get your API keys (Test mode first!)
```

**Step 2: Install Dependencies**
```bash
cd packages/payments
pnpm add stripe @stripe/stripe-js
pnpm add -D @types/stripe
```

**Step 3: Environment Variables**
```bash
# .env.local
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # We'll get this later
```

#### Day 2: Create Products & Prices in Stripe Dashboard

**Manual Setup (Recommended for MVP):**
```
1. Go to Stripe Dashboard → Products
2. Create product: "Mentorship Session Pack"
3. Set price: $X.XX (one-time payment)
4. Copy Price ID (e.g., price_1234567890)
5. Store in database: mentorship_products.stripe_price_id
```

**Why Manual First?**
- Simpler than API setup
- You can see everything in dashboard
- Less code to write
- Can automate later

#### Day 3: Create Checkout Session (Backend)

**File: `apps/web/app/api/checkout/stripe/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/packages/db/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

export async function POST(req: NextRequest) {
  try {
    const { mentorId, packId } = await req.json();
    
    // 1. Verify user is authenticated (Clerk)
    // 2. Get pack details from database
    const supabase = createClient();
    const { data: pack } = await supabase
      .from('mentorship_products')
      .select('*, mentors(*)')
      .eq('id', packId)
      .single();
    
    if (!pack) {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }
    
    // 3. Create order in database (status: pending)
    const { data: order } = await supabase
      .from('orders')
      .insert({
        user_id: userId, // from Clerk
        status: 'pending',
        provider: 'stripe',
        total_amount: pack.price,
        currency: 'usd',
      })
      .select()
      .single();
    
    // 4. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // One-time payment (NOT subscription!)
      line_items: [
        {
          price: pack.stripe_price_id, // From database
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/checkout/cancel`,
      metadata: {
        order_id: order.id, // Critical: Link to your order
        user_id: userId,
        pack_id: packId,
      },
    });
    
    // 5. Return checkout URL
    return NextResponse.json({ url: session.url });
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: 'Checkout failed' },
      { status: 500 }
    );
  }
}
```

**What This Does:**
- ✅ Creates order in your database
- ✅ Creates Stripe checkout session
- ✅ Links them via metadata
- ✅ Redirects user to Stripe-hosted checkout
- ✅ No card handling on your side (PCI compliant!)

#### Day 4: Webhook Setup

**Step 1: Get Webhook Secret**
```
1. Stripe Dashboard → Developers → Webhooks
2. Click "Add endpoint"
3. URL: https://yourdomain.com/api/webhooks/stripe
4. Select events: checkout.session.completed, charge.refunded
5. Copy "Signing secret" (whsec_...)
```

**Step 2: Webhook Handler**

**File: `apps/web/app/api/webhooks/stripe/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/packages/db/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }
  
  let event: Stripe.Event;
  
  try {
    // Verify webhook signature (CRITICAL for security!)
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  
  const supabase = createClient();
  
  // Handle different event types
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      
      // Get order_id from metadata
      const orderId = session.metadata?.order_id;
      if (!orderId) {
        console.error('No order_id in metadata');
        return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
      }
      
      // 1. Update order status to 'paid'
      await supabase
        .from('orders')
        .update({ status: 'paid' })
        .eq('id', orderId);
      
      // 2. Create payment record
      const { data: payment } = await supabase
        .from('payments')
        .insert({
          order_id: orderId,
          provider: 'stripe',
          provider_payment_id: session.payment_intent as string,
          amount: session.amount_total! / 100, // Stripe uses cents
          currency: session.currency!,
          status: 'completed',
        })
        .select()
        .single();
      
      // 3. Create session pack
      const packId = session.metadata?.pack_id;
      const userId = session.metadata?.user_id;
      
      const { data: pack } = await supabase
        .from('mentorship_products')
        .select('*, mentors(*)')
        .eq('id', packId)
        .single();
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + pack.validity_days);
      
      const { data: sessionPack } = await supabase
        .from('session_packs')
        .insert({
          user_id: userId,
          mentor_id: pack.mentor_id,
          total_sessions: pack.sessions_per_pack,
          remaining_sessions: pack.sessions_per_pack,
          purchased_at: new Date(),
          expires_at: expiresAt,
          status: 'active',
          payment_id: payment.id,
        })
        .select()
        .single();
      
      // 4. Create seat reservation
      await supabase
        .from('seat_reservations')
        .insert({
          mentor_id: pack.mentor_id,
          user_id: userId,
          session_pack_id: sessionPack.id,
          seat_expires_at: expiresAt,
          status: 'active',
        });
      
      // 5. Send notifications (Discord bot, email)
      // ... (we'll implement this later)
      
      break;
    }
    
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      
      // Find payment by provider_payment_id
      const { data: payment } = await supabase
        .from('payments')
        .select('*, orders(*)')
        .eq('provider_payment_id', charge.payment_intent)
        .single();
      
      if (payment) {
        // Update payment status
        await supabase
          .from('payments')
          .update({
            status: 'refunded',
            refunded_amount: charge.amount_refunded / 100,
          })
          .eq('id', payment.id);
        
        // Update order
        await supabase
          .from('orders')
          .update({ status: 'refunded' })
          .eq('id', payment.order_id);
        
        // Release seat and mark pack as refunded
        const { data: pack } = await supabase
          .from('session_packs')
          .select('*')
          .eq('payment_id', payment.id)
          .single();
        
        if (pack) {
          await supabase
            .from('session_packs')
            .update({ status: 'refunded', remaining_sessions: 0 })
            .eq('id', pack.id);
          
          await supabase
            .from('seat_reservations')
            .update({ status: 'released' })
            .eq('session_pack_id', pack.id);
        }
      }
      
      break;
    }
    
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  return NextResponse.json({ received: true });
}

// Disable body parsing (Stripe needs raw body)
export const runtime = 'nodejs';
```

**Critical Security Notes:**
- ✅ Always verify webhook signature
- ✅ Use idempotency (check if order already processed)
- ✅ Handle errors gracefully
- ✅ Log everything for debugging

#### Day 5: Testing

**Test Checklist:**
```
1. Create test product in Stripe Dashboard
2. Use test card: 4242 4242 4242 4242
3. Complete checkout flow
4. Verify webhook received
5. Check database: order, payment, session_pack, seat_reservation all created
6. Test refund flow
7. Verify seat released on refund
```

**Stripe Test Cards:**
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- 3D Secure: `4000 0025 0000 3155`

### Phase 2: PayPal Setup (Week 2)

**Similar pattern to Stripe, but different API:**

1. **PayPal Developer Account**
2. **Create App & Get Credentials**
3. **Create Order API** (instead of Checkout Session)
4. **Capture Payment** (two-step process)
5. **Webhook Handler** (different events)

**I'll provide complete PayPal implementation once Stripe is working.**

### Phase 3: Refund Implementation

**File: `apps/web/app/api/refunds/route.ts`**

```typescript
// Admin-only endpoint
export async function POST(req: NextRequest) {
  const { sessionPackId, reason } = await req.json();
  
  // 1. Get session pack and payment
  const { data: pack } = await supabase
    .from('session_packs')
    .select('*, payments(*)')
    .eq('id', sessionPackId)
    .single();
  
  // 2. Calculate refund amount
  const refundableSessions = pack.remaining_sessions;
  const refundAmount = (refundableSessions / pack.total_sessions) * pack.payments.amount;
  
  // 3. Process refund via provider
  if (pack.payments.provider === 'stripe') {
    await stripe.refunds.create({
      payment_intent: pack.payments.provider_payment_id,
      amount: Math.round(refundAmount * 100), // Convert to cents
      reason: 'requested_by_customer',
      metadata: {
        session_pack_id: sessionPackId,
        reason: reason,
      },
    });
  } else if (pack.payments.provider === 'paypal') {
    // PayPal refund logic
  }
  
  // 4. Webhook will handle the rest (updating database)
  
  return NextResponse.json({ success: true, refundAmount });
}
```

### Payment Implementation Checklist

- [ ] Stripe account created
- [ ] Test products created in Stripe
- [ ] Checkout endpoint implemented
- [ ] Webhook endpoint implemented
- [ ] Webhook signature verification working
- [ ] Test checkout flow end-to-end
- [ ] Test refund flow
- [ ] Error handling implemented
- [ ] Logging added
- [ ] Move to production keys
- [ ] PayPal implementation (after Stripe working)

**Estimated Time:**
- Stripe: 3-4 days (including testing)
- PayPal: 2-3 days (similar patterns)
- **Total: 1 week for both**

---

## 3. Video Recording Setup: Agora + Cloudflare + Backblaze B2

### Architecture Overview

```
┌─────────────┐
│   Agora     │ → Records video/audio
│   Cloud     │
└──────┬──────┘
       │
       │ (Egress via Cloudflare)
       ▼
┌─────────────┐
│  Cloudflare │ → CDN + Egress optimization
│   Workers   │
└──────┬──────┘
       │
       │ (Storage)
       ▼
┌─────────────┐
│ Backblaze   │ → S3-compatible storage
│     B2      │   ($0.005/GB/month)
└─────────────┘
```

### Cost Breakdown (Estimated)

**Agora Recording:**
- Recording: $0.99 per 1,000 minutes
- Example: 1-hour session = $0.06

**Cloudflare Egress:**
- First 10TB/month: FREE
- After: $0.09/GB
- For recordings: Minimal (one-time transfer)

**Backblaze B2 Storage:**
- Storage: $0.005/GB/month ($5 per TB/month)
- Download: $0.01/GB (first 10GB/day free)
- Example: 1GB recording stored 30 days = $0.005

**Total per 1-hour session:**
- Recording: $0.06
- Storage (30 days): $0.005
- **Total: ~$0.07 per session**

**For 100 sessions/month:**
- Recording: $6
- Storage: $0.50
- **Total: ~$6.50/month**

### Implementation Plan

#### Step 1: Agora Recording Setup

**File: `packages/video/agora-recording.ts`**

```typescript
import AgoraRTC from 'agora-rtc-sdk-ng';
import { AgoraAppId, AgoraAppCertificate } from '@/config';

export async function startRecording(
  channelName: string,
  uid: string
): Promise<string> {
  // 1. Get recording token from Agora
  const response = await fetch('https://api.agora.io/v1/apps/{appId}/cloud_recording/acquire', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${AgoraAppId}:${AgoraAppCertificate}`).toString('base64')}`,
    },
    body: JSON.stringify({
      cname: channelName,
      uid: uid,
      clientRequest: {
        resourceExpiredHour: 24,
        scene: 0, // 0 = rtc, 1 = broadcast
      },
    }),
  });
  
  const { resourceId } = await response.json();
  
  // 2. Start recording
  const startResponse = await fetch(`https://api.agora.io/v1/apps/${AgoraAppId}/cloud_recording/resourceid/${resourceId}/mode/mix/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${AgoraAppId}:${AgoraAppCertificate}`).toString('base64')}`,
    },
    body: JSON.stringify({
      cname: channelName,
      uid: uid,
      clientRequest: {
        token: recordingToken,
        recordingConfig: {
          maxIdleTime: 30,
          streamTypes: 2, // Audio + Video
          audioProfile: 1,
          channelType: 0,
          videoStreamType: 0,
        },
        storageConfig: {
          vendor: 0, // 0 = Agora Cloud, we'll move to B2 after
          region: 0,
          bucket: 'agora-temp', // Temporary, will move to B2
          accessKey: '',
          secretKey: '',
        },
      },
    }),
  });
  
  return resourceId;
}
```

#### Step 2: Cloudflare Worker for Egress

**File: `apps/video/workers/recording-transfer.ts`**

```typescript
// Cloudflare Worker to transfer recordings from Agora to B2
export default {
  async fetch(request: Request): Promise<Response> {
    // 1. Receive webhook from Agora when recording ready
    const { recordingUrl, sessionId } = await request.json();
    
    // 2. Download from Agora (via Cloudflare - free egress)
    const recording = await fetch(recordingUrl);
    
    // 3. Upload to Backblaze B2
    const b2Response = await uploadToB2(recording, sessionId);
    
    // 4. Update database with B2 URL
    await updateDatabase(sessionId, b2Response.url);
    
    // 5. Delete from Agora temp storage
    await deleteFromAgora(recordingUrl);
    
    return new Response('OK');
  },
};

async function uploadToB2(file: Response, sessionId: string) {
  // Backblaze B2 S3-compatible API
  const b2Url = `https://${B2_BUCKET_ID}.s3.${B2_REGION}.backblazeb2.com/${sessionId}.mp4`;
  
  const response = await fetch(b2Url, {
    method: 'PUT',
    body: file,
    headers: {
      'Authorization': `Bearer ${B2_APPLICATION_KEY}`,
      'Content-Type': 'video/mp4',
    },
  });
  
  return { url: b2Url };
}
```

#### Step 3: Backblaze B2 Setup

**Steps:**
1. Create Backblaze account
2. Create B2 bucket
3. Get Application Key ID & Key
4. Configure CORS for Cloudflare access
5. Set lifecycle policy (auto-delete after X days)

**Database Schema Addition:**

```sql
ALTER TABLE sessions ADD COLUMN recording_url TEXT;
ALTER TABLE sessions ADD COLUMN recording_expires_at TIMESTAMP;
ALTER TABLE sessions ADD COLUMN recording_consent BOOLEAN DEFAULT false;
```

#### Step 4: Recording Consent & Retention

**File: `apps/web/app/api/sessions/[id]/recording/route.ts`**

```typescript
// Before session starts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { consent, retentionDays } = await req.json();
  
  // Store consent
  await supabase
    .from('sessions')
    .update({
      recording_consent: consent,
      recording_expires_at: consent 
        ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
        : null,
    })
    .eq('id', params.id);
  
  // If consent given, start recording
  if (consent) {
    await startRecording(params.id);
  }
  
  return NextResponse.json({ success: true });
}
```

**UI Component:**

```tsx
// Recording consent dialog
export function RecordingConsentDialog({ sessionId }: { sessionId: string }) {
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Recording</DialogTitle>
        </DialogHeader>
        <p>
          This session will be recorded for your reference. Recordings are stored
          for <strong>30 days</strong> and then automatically deleted.
        </p>
        <p className="text-sm text-muted-foreground">
          Please download any recordings you want to keep before they expire.
        </p>
        <DialogFooter>
          <Button onClick={() => handleConsent(false)} variant="outline">
            Decline
          </Button>
          <Button onClick={() => handleConsent(true)}>
            I Understand & Consent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Recording Retention Policy

**Recommended:**
- **Default retention**: 30 days
- **Auto-delete**: After expiration date
- **Download reminder**: Email 7 days before expiration
- **Admin override**: Can extend retention if needed

**Database Query for Cleanup:**

```sql
-- Delete expired recordings (run daily via cron)
DELETE FROM sessions 
WHERE recording_url IS NOT NULL 
  AND recording_expires_at < NOW()
  AND status = 'completed';
```

### Recording Implementation Checklist

- [ ] Agora account created
- [ ] Recording API key obtained
- [ ] Backblaze B2 bucket created
- [ ] Cloudflare Worker created
- [ ] Recording consent UI implemented
- [ ] Recording start/stop logic
- [ ] Transfer to B2 working
- [ ] Database schema updated
- [ ] Retention policy implemented
- [ ] Auto-delete job scheduled
- [ ] Download functionality
- [ ] Email reminders before expiration

**Estimated Time: 3-4 days**

---

## 4. Tooling Integration from 5head Repo

### Files to Copy/Adapt

1. **`.cursorrules`** → Copy to mentorships-infra root
2. **`.cursor-mcp-config.json`** → Adapt for this project
3. **`.coderabbit.yaml`** → Adapt for mentorship platform
4. **`.greptile/config.yaml`** → Create new for this repo

### MCP Servers to Configure

Based on 5head setup, configure these MCPs:

```json
{
  "mcpServers": {
    "supabase-mentorships": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "${SUPABASE_MENTORSHIPS_ACCESS_TOKEN}"
      }
    },
    "stripe": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-stripe"],
      "env": {
        "STRIPE_API_KEY": "${STRIPE_API_KEY}"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "env": {
        "ALLOWED_DIRECTORIES": "${PROJECT_ROOT}"
      }
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    },
    "eslint": {
      "command": "npx",
      "args": ["-y", "@eslint/mcp@latest"],
      "env": {}
    },
    "graphiti-memory": {
      "url": "http://localhost:8000/sse",
      "env": {}
    },
    "vercel": {
      "url": "https://mcp.vercel.com",
      "env": {}
    },
    "clerk": {
      "command": "npx",
      "args": ["-y", "@clerk/agent-toolkit"],
      "env": {
        "CLERK_SECRET_KEY": "${CLERK_SECRET_KEY}"
      }
    }
  }
}
```

### CodeRabbit Configuration

Adapt `.coderabbit.yaml` for mentorship platform:

```yaml
# Key changes from 5head:
knowledge_base:
  principles:
    - "Session pack model: 4 sessions per pack, no subscriptions"
    - "Seat reservations are critical - always check availability"
    - "Payment webhooks must be idempotent"
    - "Recording consent required before sessions"
    - "24-hour minimum notice for rescheduling"
    
  mandatory_checks:
    - "Verify seat availability before creating session pack"
    - "Always validate webhook signatures"
    - "Check pack expiration before allowing bookings"
    - "Implement grace period logic for seat releases"
```

### Greptile Setup

Create `.greptile/config.yaml`:

```yaml
version: 1
name: mentorships-infra
type: monorepo
package_manager: pnpm

tech_stack:
  - next.js
  - react
  - typescript
  - tailwindcss
  - supabase
  - clerk
  - stripe
  - paypal
  - agora
  - discord.js

focus_paths:
  - apps/web/app
  - apps/web/components
  - packages/payments
  - packages/db
  - apps/bot

semantic_tags:
  payments:
    - packages/payments
    - apps/web/app/api/checkout
    - apps/web/app/api/webhooks
  sessions:
    - apps/web/app/api/sessions
    - packages/db/schema/sessions
  seat_management:
    - packages/db/schema/seat_reservations
    - apps/web/app/api/seats
```

---

## 5. Next Steps

### Immediate Actions

1. **Confirm Tech Decisions**
   - [ ] Clerk for auth (revisit at 20k users)
   - [ ] shadcn/ui for UI components
   - [ ] Stripe + PayPal for payments
   - [ ] Agora for video
   - [ ] Recording: Agora → Cloudflare → Backblaze B2

2. **Set Up Accounts**
   - [ ] Stripe account (test mode)
   - [ ] PayPal developer account
   - [ ] Agora account
   - [ ] Backblaze B2 account
   - [ ] Cloudflare account (if not already)

3. **Copy Tooling Configs**
   - [ ] Copy `.cursorrules` from 5head
   - [ ] Set up MCP servers
   - [ ] Configure CodeRabbit
   - [ ] Set up Greptile

4. **Begin Implementation**
   - [ ] Week 1: Database schema + Stripe
   - [ ] Week 2: PayPal + Webhooks
   - [ ] Week 3: Booking + Calendar
   - [ ] Week 4: Video + Recording

---

## Summary

**Auth**: Clerk (migrate to Auth.js at 20k+ users if cost justifies)
**UI**: shadcn/ui (can adopt Base UI incrementally)
**Payments**: Stripe first, PayPal second (1 week total)
**Video**: Agora (simple, good DX)
**Recording**: Agora → Cloudflare → Backblaze B2 (~$0.07/session)

**All decisions are reversible and can be optimized as you scale.**

