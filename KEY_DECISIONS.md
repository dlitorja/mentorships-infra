# Key Decisions & Preferences - Mentorship Platform

## Authentication
- **Decision**: Clerk (revisit at 20k+ users if cost justifies migration to Auth.js)
- **Rationale**: Fast setup, decoupled auth, good DX, free tier sufficient for MVP
- **Migration Path**: Can migrate to Auth.js later if needed (both use JWT)

## UI Framework
- **Decision**: shadcn/ui
- **Rationale**: Huge community, copy-paste model (you own code), AI-friendly, flexible
- **Future**: Can adopt Base UI incrementally as it matures

## Payment Processors
- **Decision**: Stripe first, PayPal second
- **Complexity**: Much simpler than initially thought (1 week for both)
- **Approach**: Step-by-step hand-holding during implementation
- **Security**: Provider-hosted checkout only, no PCI compliance needed

## Video Provider
- **Decision**: Agora
- **Rationale**: Simpler setup, better DX, sufficient for mentorship use case

## Video Recording
- **Architecture**: Agora → Cloudflare (egress) → Backblaze B2 (storage)
- **Cost**: ~$0.07 per 1-hour session
- **Retention**: 30 days default, auto-delete after expiration
- **Consent**: Required before recording, clear messaging about retention

## Tech Stack (from 5head)
- **Observability**: Axiom (logging), Better Stack (error tracking), PostHog (product analytics - planned)
- **AI**: Vercel AI SDK + OpenAI + Gemini for mentor matching chat
- **Performance**: Upstash Redis (caching, rate limiting)
- **Search**: Meilisearch (if needed for mentor search)
- **Security**: ArcJet (rate limiting, security - planned)
- **Image Upload**: react-dropzone for portfolio/homework submissions

## Operational Decisions
- **Rescheduling**: 24-hour minimum advance notice
- **Pack Expiration**: Scheduled sessions can complete, but new bookings blocked
- **Multiple Packs**: Extend current pack (add sessions, extend expiration)
- **Disputes**: Admin manual review
- **Refunds**: Only unused sessions, partial refunds based on remaining sessions

## Development Preferences
- **Package Manager**: pnpm (trusted)
- **Monorepo**: pnpm workspaces
- **Tooling**: Greptile, CodeRabbit, MCPs, .cursorrules from 5head
- **Type Safety**: Top priority, strict TypeScript
- **Testing**: Comprehensive, error scenarios not just happy paths

## Payment Implementation Approach
- **Hand-holding**: Step-by-step guidance throughout
- **Reassurance**: Constant reminders that it's simpler than it seems
- **Testing**: Thorough testing with test cards before production
- **Security**: Webhook signature verification, idempotency, no card storage

## Graphiti Memory
- **Group ID**: `mentorships-infra` for this project
- **Usage**: Store preferences, procedures, and key decisions
- **Location**: Cloud-hosted on Railway (always available)

---

**Last Updated**: Initial setup
**Next Review**: After Stripe implementation

