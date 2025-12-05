# Cost Breakdown - Mentorship Platform

## Infrastructure Costs

### Required Compute Instances

#### Meilisearch (Search Engine)

**Option 1: Railway (Quick Setup)**
- **Cost**: $0/month (uses $5 free credit)
- **Setup**: 5-15 minutes
- **Best For**: Development, MVP
- **Migration Path**: Can migrate to Google Cloud later

**Option 2: Google Cloud Compute Engine (Long-term)**
- **Cost**: $0/month (Always Free tier - e2-micro)
- **Setup**: 45-70 minutes
- **Best For**: Production, long-term
- **Resources**: 1 vCPU, 1GB RAM, 30GB storage (Always Free)

**Recommendation**: Start with Railway, migrate to Google Cloud for production.

---

## Service Costs

### Free Tiers (MVP Phase - 0-100 users)

| Service | Free Tier | Notes |
|---------|-----------|-------|
| **Meilisearch** | $0 (Railway $5 credit) | Or $0 (Google Cloud Always Free) |
| **Axiom** | Free tier | Generous limits |
| **Better Stack** | Free tier | Good for MVP |
| **PostHog** | 1M events/month | More than enough for MVP |
| **Upstash Redis** | Free tier | Sufficient for MVP |
| **ArcJet** | Free tier | Good limits |
| **Vercel** | Free tier | Hobby plan sufficient |
| **Supabase** | Free tier | 500MB database, 1GB storage |
| **Clerk** | 10k MAU | More than enough for MVP |

**Total Infrastructure Cost (MVP)**: **$0/month**

---

### Scaling Phase (100-1000 users/month)

| Service | Estimated Cost | Notes |
|---------|----------------|-------|
| **Meilisearch** | $0 | Google Cloud Always Free |
| **Axiom** | $5-10/month | ~10-20GB logs |
| **Better Stack** | $5-10/month | ~500k-1M events |
| **PostHog** | $5-10/month | ~2-3M events |
| **Upstash Redis** | $2-5/month | ~1M commands |
| **ArcJet** | $2-5/month | ~100k requests |
| **Vercel** | $20/month | Pro plan (if needed) |
| **Supabase** | $25/month | Pro plan (if needed) |
| **Clerk** | $25/month | Pro plan (if needed) |

**Total Infrastructure Cost (Scaling)**: **~$70-100/month**

---

### Payment Processing Costs

**Stripe & PayPal**: 2.9% + $0.30 per transaction

**Example**:
- $100 session pack: $3.20 fee
- 100 packs/month: $320 in fees
- Revenue: $10,000/month
- Net: $9,680/month

**Note**: These are standard payment processing fees, not infrastructure costs.

---

### Video & Recording Costs

**Agora**:
- Recording: $0.99 per 1,000 minutes
- 1-hour session: $0.06
- 100 sessions/month: $6/month

**Backblaze B2** (Storage):
- Storage: $0.005/GB/month
- 1GB per session, 30-day retention: $0.15/month for 100 sessions
- **Total Video Costs**: ~$6-7/month for 100 sessions

---

## Cost Optimization Strategies

### 1. Use Always Free Tiers

- **Google Cloud e2-micro**: Truly free forever for Meilisearch
- **Supabase Free Tier**: Sufficient for MVP (500MB database)
- **Clerk Free Tier**: 10k MAU (more than enough for MVP)

### 2. Monitor Usage

- Set up alerts for Axiom (prevent surprise bills)
- Monitor PostHog events (only track essential events)
- Track Upstash Redis usage (cache aggressively)

### 3. Optimize Storage

- Auto-delete recordings after retention period
- Compress images before upload
- Use CDN for static assets (Vercel includes this)

### 4. Scale Gradually

- Start with free tiers
- Upgrade only when hitting limits
- Use pay-per-use services (Upstash, ArcJet) to scale with usage

---

## Total Cost Estimates

### MVP Phase (0-100 users/month)
- **Infrastructure**: $0/month
- **Payment Processing**: 2.9% + $0.30 per transaction
- **Video/Recording**: ~$6-7/month (if 100 sessions)
- **Total**: **~$6-7/month + payment fees**

### Growth Phase (100-1000 users/month)
- **Infrastructure**: ~$70-100/month
- **Payment Processing**: 2.9% + $0.30 per transaction
- **Video/Recording**: ~$60-70/month (if 1000 sessions)
- **Total**: **~$130-170/month + payment fees**

### Scale Phase (1000+ users/month)
- **Infrastructure**: Scales with usage
- **Payment Processing**: 2.9% + $0.30 per transaction
- **Video/Recording**: Scales linearly
- **Total**: Scales with revenue (infrastructure ~5-10% of revenue)

---

## Cost Monitoring

### Set Up Alerts For:

1. **Axiom**: Alert at 80% of free tier
2. **PostHog**: Alert at 80% of 1M events
3. **Upstash Redis**: Alert at 80% of free tier
4. **Vercel**: Monitor bandwidth usage
5. **Supabase**: Monitor database size

### Monthly Review Checklist:

- [ ] Review Axiom usage and optimize logs
- [ ] Review PostHog events (remove unnecessary tracking)
- [ ] Check Upstash Redis cache hit rates
- [ ] Review video recording storage (clean up expired)
- [ ] Check payment processing fees (ensure competitive rates)

---

## Cost Comparison: Railway vs Google Cloud

| Feature | Railway | Google Cloud |
|---------|---------|--------------|
| **Setup Time** | 5-15 min | 45-70 min |
| **Cost (MVP)** | $0 (within $5 credit) | $0 (Always Free) |
| **Cost (Production)** | ~$2-4/month | $0 (Always Free) |
| **HTTPS** | Automatic | Manual setup |
| **Complexity** | Low | Medium |
| **Best For** | Quick setup | Long-term |

**Recommendation**: Use Railway for development, migrate to Google Cloud for production.

---

**Last Updated**: Initial cost analysis
**Next Review**: After 3 months of usage

