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

**Last Updated**: Added Git & GitHub preferences
**Total Memories Stored**: 13 key decision categories

