# Technical Decisions & Operational Specifications

## 1. Authentication: Clerk vs Auth.js

### Clerk
**Pros:**
- **Managed Service**: Zero infrastructure, hosted auth UI, built-in user management
- **Rich Features**: Pre-built components, social logins, MFA, user management dashboard
- **Developer Experience**: Excellent docs, TypeScript support, React hooks
- **Enterprise Ready**: SSO, organizations, advanced security features
- **Decoupled**: Auth is completely separate from your backend (matches your requirement)
- **Pricing**: Free tier (10k MAU), then $25/month + usage

**Cons:**
- **Vendor Lock-in**: Tied to Clerk's platform
- **Cost**: Can get expensive at scale
- **Less Control**: Can't customize auth flow as deeply
- **Dependency**: External service dependency

### Auth.js (NextAuth.js v5)
**Pros:**
- **Self-Hosted**: Full control, no vendor lock-in
- **Flexible**: Highly customizable auth flows
- **Open Source**: Free, community-driven
- **Database Agnostic**: Works with any database
- **Decoupled**: Auth logic separate from business logic
- **Cost**: $0 (hosting costs only)

**Cons:**
- **More Setup**: Need to configure providers, database, sessions yourself
- **Maintenance**: You manage security updates, scaling
- **Less Features Out-of-Box**: Need to build user management UI, MFA, etc.
- **Time Investment**: More development time required

### Recommendation: **Clerk**
**Rationale:**
- You want decoupled auth (Clerk excels here)
- Faster time to market (pre-built components)
- Better for AI-augmented development (less code to write)
- Focus on mentorship features, not auth infrastructure
- Free tier sufficient for MVP
- Can migrate to Auth.js later if needed (both use standard JWT)

---

## 2. UI Framework: Base UI vs shadcn/ui

### Base UI (MUI)
**Pros:**
- **Enterprise Backing**: MUI team's new headless component library
- **Production Ready**: Battle-tested, used by major companies
- **Accessibility**: WCAG compliant, ARIA support
- **TypeScript**: Excellent type safety
- **Future-Proof**: MUI's strategic direction
- **Documentation**: Comprehensive, professional docs

**Cons:**
- **Newer**: Less community adoption than shadcn
- **Learning Curve**: Different patterns than shadcn
- **Less Examples**: Fewer tutorials/blog posts
- **Migration**: If switching from shadcn, requires refactoring

### shadcn/ui
**Pros:**
- **Huge Community**: Massive adoption, tons of examples
- **Copy-Paste**: Components are code you own, not dependencies
- **Tailwind**: Excellent Tailwind integration
- **Flexibility**: Easy to customize (it's your code)
- **Examples**: Countless tutorials, templates, examples
- **Familiar**: Most developers know it

**Cons:**
- **Maintenance**: You maintain the component code
- **Accessibility**: Need to ensure a11y yourself
- **Future**: Depends on Radix UI (which is solid, but less "official")

### Recommendation: **shadcn/ui** (with Base UI consideration)
**Rationale:**
- **Current State**: shadcn has massive momentum, better DX for rapid development
- **AI Development**: More examples/training data for AI tools
- **Flexibility**: Copy-paste model works well for custom needs
- **Community**: Easier to find solutions to problems
- **Future Path**: Can adopt Base UI components incrementally as they mature

**Alternative Approach**: Use shadcn for MVP, evaluate Base UI for v2. Both can coexist.

---

## 3. Payment Processors: Complexity Assessment

### Good News: **Much Simpler Than You Think**

Both Stripe and PayPal are well-documented and straightforward for one-time payments.

### Stripe Implementation Complexity: **Low-Medium**

**What You Need:**
1. **Create Checkout Session** (5-10 lines of code)
   ```typescript
   const session = await stripe.checkout.sessions.create({
     mode: 'payment', // One-time payment
     line_items: [{ price: priceId, quantity: 1 }],
     success_url: `${url}/success`,
     cancel_url: `${url}/cancel`,
   });
   ```

2. **Webhook Handler** (20-30 lines)
   ```typescript
   if (event.type === 'checkout.session.completed') {
     // Create session pack, seat reservation
   }
   ```

3. **Refund** (3-5 lines)
   ```typescript
   await stripe.refunds.create({ payment_intent: paymentId });
   ```

**Time Estimate**: 2-4 hours for basic integration, 1-2 days for production-ready with error handling.

### PayPal Implementation Complexity: **Medium**

**What You Need:**
1. **Create Order** (10-15 lines)
2. **Capture Payment** (5-10 lines)
3. **Webhook Handler** (30-40 lines - slightly more complex)
4. **Refund** (5-10 lines)

**Time Estimate**: 3-5 hours for basic, 2-3 days for production-ready.

### Why It's Not Complex:

✅ **Provider-Hosted Checkout**: No PCI compliance, no card handling
✅ **Clear APIs**: Both have excellent TypeScript SDKs
✅ **Good Documentation**: Step-by-step guides available
✅ **Webhook Testing**: Both provide test tools
✅ **One-Time Payments**: Simpler than subscriptions

### Recommendation:
- **Start with Stripe** (easier, better DX)
- **Add PayPal later** (similar patterns, just different API)
- **Use abstraction layer**: Create a `PaymentProvider` interface so both work the same way

**Estimated Total Time**: 1 week for both (including testing, error handling, webhooks)

---

## 4. Video Providers: Agora vs AWS Chime

### Agora
**Pros:**
- **Developer-Friendly**: Excellent SDKs, good docs
- **Global Infrastructure**: Low latency worldwide
- **Features**: Screen sharing, recording, whiteboard
- **Pricing**: Pay-as-you-go, reasonable rates
- **Ease of Use**: Simpler setup than Chime

**Cons:**
- **Less Enterprise**: Smaller company than AWS
- **Vendor Lock-in**: Proprietary protocol

### AWS Chime
**Pros:**
- **AWS Ecosystem**: Integrates with other AWS services
- **Enterprise**: Backed by Amazon, enterprise support
- **Scalability**: AWS infrastructure
- **Familiar**: If you use AWS, consistent patterns

**Cons:**
- **More Complex**: More setup, more configuration
- **AWS Dependency**: Need AWS account, IAM, etc.
- **Steeper Learning**: More concepts to understand

### Recommendation: **Agora** (for MVP)
**Rationale:**
- Faster to implement
- Better developer experience
- Sufficient for mentorship use case
- Can migrate to Chime later if needed
- Lower operational complexity

**Implementation Complexity**: Low-Medium (1-2 days for token service)

---

## 5. Detailed Monorepo Structure

```
mentorships-infra/
├── apps/
│   ├── web/                          # Next.js Public Site + Portal
│   │   ├── app/
│   │   │   ├── (public)/            # Public routes (no auth)
│   │   │   │   ├── mentors/        # Mentor display page
│   │   │   │   └── about/
│   │   │   │   └── pricing/
│   │   │   ├── (portal)/           # Protected routes (auth required)
│   │   │   │   ├── dashboard/      # Student/Mentor dashboard
│   │   │   │   ├── sessions/       # Session management
│   │   │   │   ├── calendar/       # Booking interface
│   │   │   │   └── settings/
│   │   │   └── api/                # Next.js API routes
│   │   │       ├── webhooks/       # Stripe/PayPal webhooks
│   │   │       ├── payments/       # Payment endpoints
│   │   │       └── sessions/        # Session endpoints
│   │   └── components/
│   │
│   ├── bot/                         # Discord Bot
│   │   ├── src/
│   │   │   ├── commands/           # Bot commands
│   │   │   ├── events/             # Event handlers
│   │   │   ├── services/           # Business logic
│   │   │   └── utils/
│   │   └── package.json
│   │
│   └── video/                       # Video Token Service (optional separate service)
│       ├── src/
│       │   ├── agora/              # Agora token generation
│       │   └── chime/               # Chime token generation (future)
│       └── package.json
│
├── packages/
│   ├── db/                          # Database Schema & Migrations
│   │   ├── migrations/
│   │   ├── schema/                  # Supabase schema files
│   │   └── seed/
│   │
│   ├── payments/                    # Payment Provider Abstractions
│   │   ├── src/
│   │   │   ├── stripe/
│   │   │   ├── paypal/
│   │   │   └── types.ts            # Shared payment types
│   │   └── package.json
│   │
│   ├── calendar/                    # Google Calendar Integration
│   │   ├── src/
│   │   │   ├── oauth/
│   │   │   ├── events/
│   │   │   └── sync/
│   │   └── package.json
│   │
│   ├── messaging/                   # Notifications (Email, Discord, In-App)
│   │   ├── src/
│   │   │   ├── email/
│   │   │   ├── discord/
│   │   │   └── in-app/
│   │   └── package.json
│   │
│   ├── shared/                      # Shared Utilities
│   │   ├── src/
│   │   │   ├── types/              # Shared TypeScript types
│   │   │   ├── utils/
│   │   │   └── constants/
│   │   └── package.json
│   │
│   └── ui/                          # Shared UI Components (shadcn/ui)
│       ├── components/
│       ├── lib/
│       └── package.json
│
├── scripts/
│   ├── migrations/                  # Migration scripts
│   └── seed/                        # Seed data scripts
│
├── .cursorrules                     # Cursor AI rules (from 5head repo)
├── .greptile.yml                    # Greptile configuration
├── .coderabbit.yml                  # CodeRabbit configuration
├── package.json                     # Root package.json (workspace)
├── pnpm-workspace.yaml              # pnpm workspace config
└── turbo.json                       # Turborepo config (optional)
```

---

## 6. Operational Specifications

### Mentorship Display Page (Public)

**Features:**
- List of all active mentors
- Mentor cards showing:
  - Profile banner/image
  - Name, bio, expertise
  - Pricing (session pack price)
  - Available seats (e.g., "3 of 10 seats available")
  - "Book Now" CTA (requires auth)
- Filtering: By expertise, price range, availability
- Search: By mentor name or keywords

**Tech Stack:**
- Next.js App Router
- Public route (no auth required to view)
- Real-time seat availability (via Supabase Realtime or polling)

### Mentorship Portal (Protected)

**Student Dashboard:**
- **Session Overview Card:**
  - Remaining sessions (e.g., "2 of 4 sessions remaining")
  - Pack expiration date
  - Last session date
  - Next scheduled session
- **Quick Actions:**
  - "Book New Session" button (disabled if 0 remaining)
  - "Renew Pack" button (shown when 1 session remaining)
- **Session History:**
  - List of past sessions (date, mentor, status)
  - Upcoming sessions (with reschedule/cancel options)
- **Renewal Reminders:**
  - Banner when 1 session remaining
  - Email/Discord notifications

**Mentor Dashboard:**
- **Active Students:**
  - List of current students with remaining sessions
  - Seat utilization (e.g., "8 of 10 seats filled")
- **Session Management:**
  - Upcoming sessions calendar view
  - Past sessions
- **Availability Toggle:**
  - Pause/Resume accepting new students
- **Settings:**
  - Profile management
  - Google Calendar connection
  - Pricing management

### Session Booking Flow

1. Student clicks "Book Session"
2. **Availability Check:**
   - Verify `remaining_sessions > 0`
   - Verify pack not expired
   - Check mentor's calendar availability
3. **Time Selection:**
   - Show available time slots (from Google Calendar)
   - Respect mentor's working hours
4. **Confirmation:**
   - Create session record
   - Create Google Calendar event
   - Send confirmation (Discord + Email)
   - Decrement remaining sessions on completion

### Rescheduling Policy

**Rules:**
- Minimum 24 hours advance notice required
- Can reschedule up to 2 times per session (configurable)
- If < 24 hours: Session marked as "no-show" or requires mentor approval
- Rescheduling updates Google Calendar event automatically

**Implementation:**
```typescript
const canReschedule = (scheduledAt: Date) => {
  const hoursUntil = differenceInHours(scheduledAt, new Date());
  return hoursUntil >= 24;
};
```

### Renewal Reminder System

**Triggers:**
1. **Session 3 Completed:**
   - Email: "You have 1 session remaining. Renew now to continue."
   - Discord DM: Same message
   - In-app banner

2. **Session 4 Completed:**
   - Email: "Your pack is complete. Renew within 72 hours to keep your seat."
   - Discord DM: Same
   - Booking disabled
   - Grace period timer starts

3. **12 Hours Before Grace Expiry:**
   - Final warning email/Discord
   - "Your seat will be released in 12 hours"

4. **Grace Expired:**
   - Seat released
   - Waitlist notified
   - Student notified (if they want to rejoin waitlist)

### Video Call Setup

**Agora Implementation:**
1. **Token Generation Service:**
   - Endpoint: `POST /api/video/token`
   - Validates: Session exists, is scheduled, pack valid
   - Returns: Agora token with room ID

2. **Client Integration:**
   - Student/Mentor join same room ID
   - Token expires 1 hour after session end time
   - Pre-join: Can join 15 minutes early
   - Post-join: Access expires 30 minutes after scheduled end

3. **Access Control:**
   ```typescript
   const canAccessVideo = (session: Session, pack: SessionPack) => {
     return (
       session.status === 'scheduled' &&
       pack.remaining_sessions > 0 &&
       pack.expires_at > new Date() &&
       isWithinTimeWindow(session.scheduled_at)
     );
   };
   ```

### Discord Bot Architecture

**Separate App in Monorepo:**
- `apps/bot/` - Standalone Node.js/TypeScript application
- Uses Discord.js library
- Listens to database events (via Supabase Realtime or polling)
- Sends DMs, channel messages
- Handles rate limiting, retries, fallbacks

**Event Triggers:**
- Database changes trigger bot actions
- Webhook from main API can trigger bot
- Scheduled jobs for reminders

**Message Queue:**
- If bot offline, queue messages
- Retry failed sends
- Fallback to email if Discord unavailable

---

## 7. Tooling Integration

### From 5head Repo (Need GitHub URL)

**Expected Integrations:**
- **.cursorrules**: AI coding guidelines, patterns, preferences
- **Greptile**: Code search and navigation
- **CodeRabbit**: Automated code reviews
- **MCPs**: Model Context Protocol configurations

**Action Required:** Please provide GitHub URL to 5head repo so we can:
1. Review the .cursorrules patterns
2. Understand the MCP setup
3. Replicate the tooling configuration
4. Ensure consistency with your preferred patterns

---

## 8. Development Timeline Estimates

### Phase 1: Foundation (Week 1-2)
- Monorepo setup
- Database schema & migrations
- Auth setup (Clerk)
- Basic UI structure (shadcn/ui)

### Phase 2: Core Features (Week 3-4)
- Session pack logic
- Seat reservation system
- Booking rules & calendar integration

### Phase 3: Payments (Week 5-6)
- Stripe integration
- PayPal integration
- Webhook handling
- Refund logic

### Phase 4: Automation (Week 7-8)
- Discord bot
- Email notifications
- Renewal reminders
- Expiration jobs

### Phase 5: Video & Polish (Week 9-10)
- Agora integration
- Video access control
- Admin dashboard
- Testing & bug fixes

**Total Estimate: 10 weeks for MVP**

---

## 9. Risk Mitigation

### Payment Complexity Concerns
✅ **Mitigated**: One-time payments are straightforward
✅ **Mitigated**: Provider-hosted checkout = no PCI
✅ **Mitigated**: Good documentation & SDKs
✅ **Mitigated**: Start with Stripe, add PayPal later

### Auth Decoupling
✅ **Mitigated**: Clerk provides decoupled auth
✅ **Mitigated**: JWT tokens work with any backend
✅ **Mitigated**: Can migrate to Auth.js later if needed

### UI Framework Future-Proofing
✅ **Mitigated**: shadcn/ui is code you own (not locked in)
✅ **Mitigated**: Can adopt Base UI incrementally
✅ **Mitigated**: Both use standard React patterns

---

## 10. Next Steps

1. **Provide 5head Repo URL**: So we can review tooling setup
2. **Confirm Tech Stack**: Review and approve decisions above
3. **Clarify Any Questions**: Address any remaining concerns
4. **Create Detailed Plan**: Once decisions are finalized
5. **Begin Implementation**: Start with monorepo setup

---

## Summary of Recommendations

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **Auth** | Clerk | Decoupled, fast, good DX, free tier |
| **UI** | shadcn/ui | Community, flexibility, AI-friendly |
| **Payments** | Stripe first, PayPal second | Stripe easier, both straightforward |
| **Video** | Agora | Simpler, better DX for MVP |
| **Monorepo** | pnpm workspaces + Turborepo | Fast, efficient, good tooling |

**All decisions are reversible** - can migrate later if needed.

