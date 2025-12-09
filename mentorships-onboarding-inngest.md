```markdown
# Inngest Onboarding Plan for Huckleberry Mentorships

## Project Context
Replace manual Kajabi processes with event-driven Next.js app handling 1-on-1/group mentorship purchases, Clerk auth (email/Google SSO), Discord OAuth, dashboard access. [memory:37][memory:44]

## Core Workflow
```
purchase/mentorship → Clerk user lookup → Discord OAuth email 
→ Wait discord.connected (dashboard/email) → Grant dashboard access
```

## Key Events & Triggers
- `purchase/mentorship` (Stripe/PayPal → Inngest.send())
- `clerk/user.created` (webhook auto-forwards)
- `user/discord.connected` (OAuth callback from dashboard/email)
- Resend webhooks (email opens/bounces) [web:21][web:34]

## Setup Checklist
1. **API Route**: `/api/inngest` with Inngest SDK
2. **Clerk**: Dashboard → Webhooks → Inngest endpoint
3. **Resend**: Email templates + webhooks to Inngest
4. **Functions**:
   ```
   inngest.createFunction(
     { id: "onboarding-flow" },
     { event: "purchase/mentorship" },
     async ({ event, step }) => {
       const user = await step.run("get-clerk-user", () => 
         clerk.users.getUser(event.data.clerkId)
       );
       await step.run("send-discord-email", () => 
         resend.emails.send({
           to: user.emailAddresses.emailAddress,
           discordOAuthLink: `https://yourapp.com/auth/discord?clerkId=${user.id}`
         })
       );
       await step.sleep("wait-discord", "48h");
       // Follow-up if no discord.connected
     }
   );
   ```
5. **Local Dev**: `npx inngest-cli@latest dev` [web:1][web:5]

## Integration Points
| Service | Event Flow | Code Location |
|---------|------------|---------------|
| Stripe/PayPal | `checkout.session.completed` → `purchase/mentorship` | Payment webhook handler |
| Clerk | `user.created` → auto-forwards to Inngest | Clerk dashboard setup |
| Discord OAuth | Dashboard button → `user/discord.connected` | `/api/auth/discord/callback` |
| Resend | Email sent → webhooks track opens | Inngest Resend guide [web:19] |

## AI Tool Instructions (Cursor/Greptile/Coderabbit)

**Cursor Commands**:
```
@web Generate Inngest setup in src/app/api/inngest/route.ts
@web Add Clerk webhook integration to Inngest
@web Create purchase/mentorship → Discord onboarding workflow
```

**Files to Create**:
```
src/inngest/
├── onboarding.ts
├── types.ts
└── email-templates/
src/app/api/
├── inngest/route.ts
├── stripe/webhook/route.ts
└── discord/callback/route.ts
```

## Deployment
```
vercel --prod
# Clerk dashboard: add Inngest webhook
# Test: npx inngest-cli@latest dev --url http://localhost:3000/api/inngest
```

**References**: 
- Inngest Docs: https://www.inngest.com/docs [web:4]
- Clerk Integration: https://www.inngest.com/docs/guides/clerk-webhook-events [web:34]
- Resend Guide: https://www.inngest.com/docs/guides/resend-webhook-events [web:19]

*Generated Dec 8, 2025 for Huckleberry Art Academy mentorship automation*
```

Copy entire block above into `inngest-onboarding-plan.md`[1]

[1](https://www.inngest.com/blog/building-auth-workflows-with-clerk-integration)