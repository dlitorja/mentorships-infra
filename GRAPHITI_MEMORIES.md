# Graphiti Memory - Key Decisions & Considerations

## Status

✅ **Graphiti Server**: Connected and working
- **Status**: OK
- **Database**: Connected to falkordb
- **Group ID**: `mentorships-infra`

## Stored Memories

All key decisions and considerations have been stored in Graphiti memory with group_id `mentorships-infra`. These memories will persist across sessions and help maintain context.

### Memory Categories Stored:

1. **Tech Stack Decisions - Core Framework**
   - Drizzle ORM, shadcn/ui, Clerk, pnpm, TanStack Form priority

2. **Payment Implementation Strategy**
   - Stripe first, PayPal second, step-by-step hand-holding approach

3. **Video & Recording Architecture**
   - Agora → Cloudflare → Backblaze B2, consent required, 30-day retention

4. **Observability & Performance Stack**
   - Axiom, Better Stack, PostHog, Upstash Redis, Meilisearch, ArcJet

5. **Session Pack & Seat Management Rules**
   - 4 sessions per pack, seat release conditions, grace periods

6. **Operational Policies**
   - 24-hour rescheduling notice, dispute resolution, refund policies

7. **Infrastructure Costs & Hosting**
   - Railway vs Google Cloud for Meilisearch, cost estimates

8. **Development Preferences & Standards**
   - Type safety priority, testing requirements, security guidelines

9. **Payment Implementation Hand-Holding Approach**
   - Step-by-step guidance, reassurance, testing checklists

10. **Monorepo Structure & Organization**
    - Directory structure, tooling configs, workspace setup

11. **Key Considerations Before Building**
    - MCP verification, database schema first, critical checks

12. **User Scale & Cost Context**
    - Current scale (16-19 users), future scale considerations

13. **Git & GitHub Workflow Preferences**
    - Conventional Commits (Enterprise Standard)
    - Branch naming: `<type>/<description>`
    - PR workflow optimized for Greptile/CodeRabbit/Vercel
    - Squash merge strategy
    - Mix commit frequency (starting with larger logical commits)

14. **Greptile CLI Usage**
    - Installation: `npm install -g greptile && greptile addPath`
    - Authentication: `greptile auth` (GitHub)
    - Add repos: `greptile add [repo link or owner/repo]` (up to 10 per session)
    - Start session: `greptile start` (interactive shell for asking questions)
    - Other commands: `greptile list`, `greptile remove <repo>`, `greptile help`
    - Workflow: Install → Auth → Add repos → Start → Ask questions with full codebase context

15. **White-Label SaaS Pricing Strategy - Overview**
    - Platform being considered for sale as white-label SaaS to artists
    - Subscription-based pricing with per-instructor-seat billing
    - Comprehensive solution (payments, video, scheduling, automation, dashboards)

16. **Pricing Strategy - Competitive Landscape**
    - Art of Education: $43-53/month, Digital Art Academy: $22/month
    - Platform positioned above basic but below premium solutions

17. **Pricing Strategy - Recommended Tiered Pricing Model**
    - Starter: $29/month (10 students), Professional: $49/month (25 students)
    - Enterprise: $99/month (unlimited), 17% annual discount
    - Alternative: $35/month value-based pricing recommended

18. **Pricing Strategy - Additional Considerations**
    - Transaction fees: Include in base price (Option A) recommended
    - Setup fees: $99-199 one-time for Professional/Enterprise
    - Free trial: 14-30 days recommended

19. **Pricing Strategy - Key Discussion Questions**
    - Target market, competitive positioning, revenue model
    - Feature gating, student limits, annual vs monthly, multi-instructor orgs

20. **Pricing Strategy - Implementation Requirements**
    - Technical: Stripe Billing, usage tracking, feature flagging
    - Business: ToS, SLAs, support tiers, onboarding docs
    - Go-to-Market: Pricing page, sales materials, customer success

21. **Pricing Strategy - Platform Value Proposition**
    - Complete mentorship business platform (not just course delivery)
    - Full payment processing, video conferencing, scheduling, automation

## How to Use

### Search for Decisions

```typescript
// In Cursor, you can ask:
"@graphiti What payment implementation approach should we use?"
"@graphiti What are the seat management rules?"
"@graphiti What infrastructure costs should I consider?"
```

### Add New Memories

When making new decisions or learning preferences, add them to Graphiti:

```typescript
mcp_graphiti-memory_add_memory(
  name="New Decision",
  episode_body="Decision details...",
  group_id="mentorships-infra"
)
```

### Search Existing Memories

```typescript
mcp_graphiti-memory_search_nodes(
  query="What are the payment requirements?",
  group_ids=["mentorships-infra"]
)
```

## Memory Maintenance

- **Group ID**: Always use `mentorships-infra` for this project
- **Updates**: When decisions change, add new memories (Graphiti handles updates)
- **Search**: Use semantic search to find relevant memories before making decisions

---

**Last Updated**: Added pricing strategy for white-label SaaS offering
**Total Memories Stored**: 21 key decision categories

