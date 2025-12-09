#!/bin/bash
# Script to add pricing strategy memories to Graphiti via API
# Usage: ./scripts/add-pricing-memories.sh

GRAPHITI_URL="https://knowledge-graph-mcp-production-cdc6.up.railway.app"
GROUP_ID="mentorships-infra"

# Memory 1: White-Label SaaS Pricing Strategy - Overview
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "White-Label SaaS Pricing Strategy - Overview",
    "episode_body": "The mentorship platform is being considered for sale as a white-label SaaS solution to artists who want to start their own mentorship businesses (competitors to Huckleberry Art). The proposed model is subscription-based pricing with per-instructor-seat billing. This is positioned as a comprehensive white-label solution, not just a course platform. The platform includes full payment processing (Stripe + PayPal), video conferencing (Agora), Google Calendar scheduling, seat management, Discord bot automation, student/instructor dashboards, session pack management, renewal reminders, profile management, and analytics. This is a complete mentorship business platform, not just a course delivery system.",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"

# Memory 2: Pricing Strategy - Competitive Landscape
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "Pricing Strategy - Competitive Landscape",
    "episode_body": "Market analysis shows competitive pricing: Art of Education charges $43-53/month per instructor (curriculum & lesson plans focus), Digital Art Academy charges $22/month per instructor (lesson access), and Artusi offers free instructor accounts (charges students directly). Our platform is positioned above basic course platforms but below premium solutions, reflecting our comprehensive feature set including payments, video, automation, and full business management tools.",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"

# Memory 3: Pricing Strategy - Recommended Tiered Pricing Model
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "Pricing Strategy - Recommended Tiered Pricing Model",
    "episode_body": "Recommended pricing model: Tiered pricing with three tiers. Starter Plan: $29/instructor/month (up to 10 active students, all core features, email support, standard onboarding). Professional Plan: $49/instructor/month (up to 25 active students, priority support, advanced analytics, custom branding, dedicated onboarding). Enterprise Plan: $99/instructor/month (unlimited students, dedicated account manager, custom integrations, SLA guarantees, white-glove onboarding). Annual discount: 17% off (e.g., Starter: $290/year vs $348/monthly). Alternative simple pricing: $25-30/instructor/month (all features, no student limits, email support). Value-based alternative: $35/instructor/month recommended starting point (above basic platforms at $22, below premium at $43-53, reflects comprehensive feature set, room for growth with tiers later).",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"

# Memory 4: Pricing Strategy - Additional Considerations
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "Pricing Strategy - Additional Considerations",
    "episode_body": "Transaction fees: Option A - Include in base price (simpler, predictable, no surprise fees, easier to communicate, may limit high-volume instructors). Option B - Add 2-3% on top of payment processor fees (scales with instructor success, lower base price barrier, more complex). Recommendation: Start with Option A (included), consider Option B for Enterprise tier. Setup/Onboarding fees: Starter included in first month, Professional $99 one-time, Enterprise $199 one-time (covers onboarding costs, filters serious customers, can be waived for annual commitments). Free trial: 14-30 day free trial recommended (no credit card required initially, full feature access, reduces friction, can convert to paid after trial).",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"

# Memory 5: Pricing Strategy - Key Discussion Questions
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "Pricing Strategy - Key Discussion Questions",
    "episode_body": "Key questions for pricing strategy discussion: 1) Target Market - What'\''s typical income level? Currently using other platforms (Kajabi, Teachable)? Willingness to pay? 2) Competitive Positioning - Premium (higher price, more features) or affordable alternative (lower price, market share)? Unique selling proposition? 3) Revenue Model - Per-instructor only? Transaction-based revenue share? Usage-based for high-volume? 4) Feature Gating - All features at base price? Gate advanced features (analytics, branding) in higher tiers? Must-haves vs nice-to-haves? 5) Student Limits - Cap active students per instructor? Charge per active student instead? Typical instructor:student ratio? 6) Annual vs Monthly - What discount for annual? Annual as default? Prorated refunds? 7) Multi-Instructor Organizations - Team/organization pricing? Volume discounts? Shared resources handling?",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"

# Memory 6: Pricing Strategy - Implementation Requirements
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "Pricing Strategy - Implementation Requirements",
    "episode_body": "Technical requirements for SaaS pricing: Subscription management system (Stripe Billing or similar), usage tracking (active students, sessions), feature flagging for tier-based access, billing dashboard for customers, usage analytics for pricing optimization. Business requirements: Terms of Service for SaaS offering, SLA definitions for each tier, support tier definitions, onboarding process documentation, pricing page design & copy. Go-to-Market: Pricing page on marketing site, sales materials (feature comparison, ROI calculator), customer success playbook, support documentation, migration path from current Huckleberry Art setup. Next steps: Validate assumptions with potential customers (surveys, interviews), build pricing page with clear feature comparison, implement subscription system (Stripe Billing recommended), create onboarding flow for new SaaS customers, develop support tiers and documentation, test pricing with beta customers before public launch.",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"

# Memory 7: Pricing Strategy - Platform Value Proposition
curl -X POST "${GRAPHITI_URL}/api/memories" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "name": "Pricing Strategy - Platform Value Proposition",
    "episode_body": "Platform offers comprehensive white-label mentorship business solution with full payment processing (Stripe + PayPal integration), video conferencing (Agora integration), Google Calendar scheduling (automated booking system), seat management & retention (automated seat release system), Discord bot automation (notifications & reminders), student/instructor dashboards (full management interface), session pack management (4-session pack model), renewal reminders (automated notifications), profile & portfolio management (instructor branding), session history & analytics (tracking & reporting). Key differentiator: This is a complete mentorship business platform, not just a course delivery system. Significantly more than basic course platforms.",
    "group_id": "'"${GROUP_ID}"'"
  }'

echo -e "\n---\n"
echo "All pricing strategy memories added!"

