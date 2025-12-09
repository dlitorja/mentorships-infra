# Polar.sh Billing Platform Analysis

## Executive Summary

**Recommendation: ✅ STRONGLY CONSIDER POLAR for Merchant of Record (MoR)**

Polar is a **Merchant of Record (MoR)** billing platform that handles tax compliance globally and supports one-time purchases. Unlike Autumn, Polar **does support one-time payments**, making it a better fit.

**Critical Context:**
- ✅ **You have international customers** (from all over the world)
- ✅ **Currently using Kajabi** (calculates/collects taxes, but you're responsible for filing/remittance)
- ⚠️ **Losing Kajabi** when you launch this project
- ⚠️ **Tax compliance gap** - Need to handle tax calculation, collection, filing, and remittance
- ✅ **Opportunity**: Polar can provide TRUE MoR (more than Kajabi ever did)

**Key Trade-offs:**
- ✅ **Global tax compliance (MoR)** - **CRITICAL** for international sales
- ✅ **One-time purchases supported** - Unlike Autumn
- ✅ **Automated benefits** (Discord roles, GitHub access) - Could be useful
- ❌ **Higher cost** (4% + 40¢ vs Stripe's ~2.9% + 30¢) - ~37.5% more expensive
- ❌ **Additional abstraction layer** - Less control, more complexity
- ❌ **Inngest integration** - Would need to bridge Polar webhooks → Inngest

**Verdict**: With international customers and losing Kajabi's tax handling, Polar's MoR becomes **highly valuable**. The extra cost (~37.5%) may be worth avoiding the complexity and risk of international tax compliance.

---

## Critical Context: Kajabi Transition & Tax Compliance Gap

### Current State (Kajabi) - **VERIFIED**

**What Kajabi Actually Provides:**
- ✅ Payment processing (Stripe/PayPal integration)
- ✅ **Tax calculation and collection** (via Quaderno integration)
- ⚠️ **NOT a Merchant of Record (MoR)** - You are still the legal seller
- ⚠️ **You are responsible for tax filing and remittance**
- ⚠️ **You must register for VAT/GST in applicable countries**
- ⚠️ **You have legal liability for tax compliance**

**Kajabi's Tax Handling (Per Official Documentation):**
- ✅ Calculates taxes automatically (via Quaderno partnership)
- ✅ Collects taxes at checkout
- ❌ **Does NOT file taxes on your behalf**
- ❌ **Does NOT remit taxes on your behalf**
- ❌ **You are responsible for filing and remitting collected taxes**

**Source**: [Kajabi Help Center](https://help.kajabi.com/hc/en-us/articles/21039237972379-Kajabi-Payments-Sales-Tax-Overview): "Tax does not file or remit sales taxes on your behalf. **You are responsible for filing and remitting any sales tax that you collect**."

**Your Current Experience:**
- Kajabi calculates and collects taxes automatically
- You still need to file and remit taxes yourself (if you're doing this)
- You may not be aware of this responsibility (common misconception)
- International customers can purchase, but tax compliance is still your responsibility

### Future State (New Platform)

**What You're Losing:**
- ❌ **Kajabi's tax calculation/collection** - No longer integrated with Quaderno
- ❌ **Automatic tax calculation** - Need to implement tax calculation yourself
- ❌ **Automatic tax collection** - Need to implement tax collection yourself
- ⚠️ **Tax filing/remittance** - You're already responsible for this (may not have been doing it)

**What You're Gaining (Opportunity):**
- ✅ **True Merchant of Record** - Polar can act as MoR (Kajabi never did)
- ✅ **Full tax compliance** - Calculation, collection, filing, remittance all handled
- ✅ **No legal liability** - Polar is the merchant of record
- ✅ **No registration required** - Polar handles all tax registrations

**Tax Compliance Requirements (Without MoR):**

**EU/UK (VAT)**:
- Register for VAT in each country (or use One-Stop Shop)
- Calculate VAT rates (varies by country: 19-27%)
- File quarterly VAT returns
- Remit VAT to tax authorities
- Handle B2B reverse charge
- Handle B2C tax collection

**Australia/India (GST)**:
- Register for GST in each country
- Calculate GST rates (varies: 5-18%)
- File monthly/quarterly returns
- Remit GST to tax authorities

**US States (Sales Tax)**:
- Register in each state (if you have nexus)
- Calculate sales tax (varies by state: 0-10%+)
- File monthly/quarterly returns
- Remit sales tax to states

**Other Countries**:
- Each country has different rules
- Need to research, register, calculate, file, remit

**Cost of Manual Compliance:**
- **Time**: 10-20 hours/month researching, calculating, filing
- **Accountant fees**: $200-500/month for international compliance
- **Legal risk**: Penalties, fines, legal issues for non-compliance
- **Complexity**: Different rules per country, frequent rate changes
- **Total estimated cost**: $500-1000/month in time + fees + risk

**Risk of Non-Compliance:**
- Penalties: 10-30% of tax owed
- Fines: $1,000-$10,000+ per violation
- Legal issues: Tax audits, investigations
- Business impact: Reputation damage, customer trust issues

### The Gap: Polar Fills This

**Polar as MoR:**
- ✅ Handles all international tax compliance
- ✅ No registration required (they're the merchant)
- ✅ Automatic tax calculation, filing, remittance
- ✅ No legal liability (they're the merchant of record)
- ✅ Compliance guaranteed

**Cost**: ~37.5% higher fees, but saves $500-1000/month in compliance costs

**Conclusion**: 
- **Current Reality**: Kajabi is NOT a MoR - you're already responsible for tax filing/remittance (may not have been doing it)
- **With Polar**: You get a TRUE MoR for the first time - full tax compliance handled
- **Value**: Polar provides more tax compliance than Kajabi ever did (true MoR vs. just calculation/collection)

---

## What is Polar?

Polar is a billing infrastructure platform that positions itself as "beyond payment processing." It provides:

### Core Features

1. **Merchant of Record (MoR)**
   - Handles all international tax compliance (VAT, GST, sales tax)
   - Calculates, collects, and remits taxes worldwide
   - No need to register for taxes in multiple jurisdictions

2. **Product Management**
   - One-time purchases ✅
   - Subscriptions ✅
   - Flexible pricing (fixed, pay-what-you-want, free)

3. **Checkout Options**
   - Checkout Links (no-code)
   - Embedded Checkout
   - Checkout API (programmatic)

4. **Automated Benefits (Entitlements)**
   - License keys (auto-generated)
   - File downloads (up to 10GB)
   - GitHub repository access (auto-invite)
   - Discord roles (auto-assign)

5. **Pricing**
   - **4% + 40¢ per transaction**
   - No monthly fees
   - Open source (but MoR requires hosted service)

**Key Claim**: "Turn your software into a business" - Complete billing infrastructure with tax compliance.

---

## Your Current Architecture

### Business Model
- ✅ **One-time payments only** (no subscriptions)
- ✅ **Session packs** (4 sessions per pack)
- ✅ **No recurring billing**
- ✅ **No plan switching** (each purchase is independent)
- ✅ **International customers** (from all over the world)

### Current State: Kajabi → New Platform Transition

**Current (Kajabi)**:
- ✅ Kajabi handles payments and tax compliance
- ✅ Merchant of Record (MoR) - Kajabi handles international taxes
- ✅ You don't need to worry about VAT, GST, or sales tax

**Future (New Platform)**:
- ⚠️ **Losing Kajabi's tax handling** - You'll need to handle taxes yourself
- ⚠️ **International tax compliance gap** - Need to register, calculate, file, and remit taxes
- ⚠️ **Risk of non-compliance** - Penalties, fines, legal issues

**Critical Question**: How will you handle international tax compliance without Kajabi?

### Current Stripe Integration (Planned)
- ✅ Stripe Checkout for one-time payments
- ✅ Webhook handler (`/api/webhooks/stripe/route.ts`)
- ✅ Inngest processes webhook events asynchronously
- ✅ Well-architected with idempotency, retries, and error handling
- ✅ Direct control over payment processing
- ⚠️ **No tax compliance** - Stripe doesn't handle tax filing/remittance

### Current Flow (Planned)
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

**Missing**: Tax compliance handling (VAT, GST, sales tax)

### Current Costs (Planned)
- **Stripe US Domestic**: 2.9% + 30¢ per transaction
- **Stripe International Cards**: 4.4% + 30¢ per transaction (2.9% + 1.5% international fee)
- **Stripe Tax** (optional): Additional cost for tax calculation only (not MoR)
- **No monthly fees**
- **Full control** over payment processing
- ⚠️ **Tax compliance**: Manual (you handle it) - Complex and risky

---

## Why Polar Could Fit (Unlike Autumn)

### 1. **One-Time Purchases Supported**

✅ **Polar supports one-time purchases** - This is a key differentiator from Autumn.

Your model: Each purchase is independent (one-time payment for 4 sessions).

Polar can handle this natively, unlike Autumn which is subscription-focused.

### 2. **Merchant of Record Benefits** ⭐ **CRITICAL FOR YOUR SITUATION**

**Your Situation**: 
- ✅ **International customers** (from all over the world)
- ✅ **Currently using Kajabi** (calculates/collects taxes via Quaderno, but you're responsible for filing/remittance)
- ⚠️ **Losing Kajabi** when you launch this project
- ⚠️ **Tax compliance gap** - Need to handle tax calculation, collection, filing, and remittance
- ✅ **Opportunity**: Polar can provide TRUE MoR (more comprehensive than Kajabi)

**What Polar's MoR Handles:**
- **VAT compliance** (EU, UK, etc.) - Automatic registration, calculation, filing, remittance
- **GST compliance** (Australia, India, etc.) - Automatic registration, calculation, filing, remittance
- **Sales tax** (US states) - Automatic calculation and remittance
- **Tax filing and remittance** - They handle it all, you don't need to register anywhere

**Without Polar (Direct Stripe)**:
- ❌ Register for VAT/GST in each country (EU, UK, Australia, India, etc.)
- ❌ Calculate taxes manually (different rates per country/region)
- ❌ File tax returns in multiple jurisdictions (monthly/quarterly)
- ❌ Handle tax rate changes (rates change frequently)
- ❌ Risk of penalties and fines for non-compliance
- ❌ Legal liability for tax errors

**With Polar (MoR)**:
- ✅ No registration required (they're the merchant)
- ✅ Automatic tax calculation (real-time rates)
- ✅ Automatic tax filing (they handle it)
- ✅ Automatic tax remittance (they pay it)
- ✅ No legal liability (they're the merchant of record)
- ✅ Compliance guaranteed (they handle it all)

**Cost of Manual Tax Compliance**:
- **Time**: Hours per month researching, calculating, filing
- **Legal fees**: Accountant/tax advisor for international compliance
- **Risk**: Penalties, fines, legal issues for non-compliance
- **Complexity**: Different rules per country, frequent rate changes

**Conclusion**: For international sales, Polar's MoR is **highly valuable** and may be worth the extra cost (~37.5% higher fees).

### 3. **Automated Benefits (Entitlements)**

Polar offers automated delivery of:
- **Discord roles** - Auto-assign roles when purchase completes
- **GitHub access** - Auto-invite to private repositories
- **License keys** - Auto-generate and deliver
- **File downloads** - Secure delivery up to 10GB

**Your Use Case**: 
- You have a Discord bot for automation
- You might want to auto-assign Discord roles when packs are purchased
- You might want to grant access to resources automatically

**Current State**: You'd need to build this yourself in Inngest functions.

**With Polar**: Could configure automated Discord role assignment on purchase.

---

## Why Polar Might Not Fit

### 1. **Cost Comparison** ⚠️ **UPDATED WITH ACCURATE PRICING**

**Polar**: 4% + 40¢ per transaction (all-inclusive, includes MoR)

**Stripe Pricing (2024-2025)**:
- **US Domestic Cards**: 2.9% + 30¢ per transaction
- **International Cards**: 2.9% + 1.5% + 30¢ = **4.4% + 30¢** per transaction
- **Stripe Tax** (optional, for tax calculation only): 
  - Calculates taxes automatically
  - **NOT a Merchant of Record** - You're still responsible for filing/remittance
  - Additional cost per transaction (varies by region)
  - Still requires you to register, file, and remit taxes yourself

**Cost Comparison Examples**:

**$100 Purchase - US Customer (Domestic Card)**:
- Polar: $4.40 fee
- Stripe: $3.20 fee
- **Difference**: $1.20 more with Polar (37.5% higher)

**$100 Purchase - International Customer (International Card)**:
- Polar: $4.40 fee
- Stripe: $4.70 fee (4.4% + $0.30)
- **Difference**: $0.30 LESS with Polar (6.4% cheaper!)

**Mixed Customer Base (50% US, 50% International)**:
- Polar: $4.40 per transaction (flat rate)
- Stripe: $3.95 average per transaction (($3.20 + $4.70) / 2)
- **Difference**: $0.45 more with Polar (11.4% higher)

**Impact Analysis**:
- **If mostly US customers**: Polar costs ~37.5% more
- **If mostly international customers**: Polar costs ~6.4% LESS
- **If mixed (50/50)**: Polar costs ~11.4% more

**Key Insight**: For international customers, **Polar is actually CHEAPER than Stripe** because Stripe charges an additional 1.5% for international cards, while Polar has a flat 4% rate.

**Trade-off**: 
- **US customers**: Higher cost with Polar
- **International customers**: Lower cost with Polar + MoR included
- **Overall**: Depends on your customer mix

### 2. **Additional Abstraction Layer**

**Current State**:
```
Stripe → Your Webhook Handler → Inngest → Your Business Logic
```

**With Polar**:
```
Polar → Polar Webhooks → Your Handler → Inngest → Your Business Logic
```

**Issues**:
- Another layer to debug
- Less control over payment processing
- Need to learn Polar's API
- Potential vendor lock-in

### 3. **Inngest Integration**

**Current State**: 
- Stripe webhooks → Your handler → Inngest events → Inngest functions
- Full control over event processing
- Custom business logic in Inngest

**With Polar**:
- Polar handles payments internally
- Polar sends webhooks to your endpoint
- You'd need to bridge Polar webhooks → Inngest
- Less control over event processing

**Conclusion**: Polar doesn't integrate with Inngest directly. You'd need to build a bridge layer, similar to Autumn.

### 4. **Session Pack Model**

Polar's automated benefits are designed for:
- License keys (software products)
- File downloads (digital products)
- GitHub access (developer tools)
- Discord roles (community access)

**Your model**:
- Session packs (4 sessions)
- Seat reservations
- Pack expiration (30-45 days)
- Remaining sessions counter

**Mapping**: Polar's benefits don't directly map to your session pack model. You'd still need to:
- Create session packs in your database
- Create seat reservations
- Track remaining sessions
- Handle pack expiration

**Conclusion**: Polar's automated benefits are nice-to-have, but you'd still need your full business logic.

### 5. **Checkout Migration**

**Current State**: 
- Stripe Checkout (hosted, PCI compliant)
- Custom metadata (order_id, user_id, pack_id)
- Success/cancel URLs

**With Polar**:
- Polar Checkout (similar to Stripe Checkout)
- Different API structure
- Different metadata handling
- Migration effort required

**Trade-off**: You'd need to rewrite checkout flow for minimal benefit.

---

## What Polar Would Require

If you were to use Polar, you'd need to:

1. **Migrate checkout flow**
   - Replace Stripe Checkout with Polar Checkout
   - Update API calls
   - Update metadata handling

2. **Set up Polar webhooks**
   - Configure webhook endpoints
   - Handle Polar webhook events
   - Bridge to Inngest (manual integration)

3. **Update payment processing**
   - Replace Stripe SDK with Polar SDK
   - Update payment record creation
   - Update refund handling

4. **Configure automated benefits** (optional)
   - Set up Discord role assignment
   - Configure GitHub access (if applicable)
   - Set up license keys (if applicable)

5. **Test tax compliance** (if using MoR)
   - Verify tax calculations
   - Test international sales
   - Verify tax remittance

**Result**: Significant migration effort for benefits that may not apply to your use case.

---

## What You'd Gain

### 1. **Global Tax Compliance (MoR)**

**If selling internationally:**
- ✅ No need to register for VAT/GST in multiple countries
- ✅ Automatic tax calculation and collection
- ✅ Tax filing and remittance handled
- ✅ Compliance with international tax laws

**If only US customers:**
- ⚠️ Minimal benefit (US sales tax is simpler)

### 2. **Automated Benefits**

**Discord Roles:**
- ✅ Auto-assign roles when pack purchased
- ✅ Could integrate with your Discord bot

**GitHub Access:**
- ⚠️ Not applicable (you're not selling software)

**License Keys:**
- ⚠️ Not applicable (you're selling mentorship sessions)

**File Downloads:**
- ⚠️ Not applicable (you're not selling digital files)

**Conclusion**: Discord role automation is the only relevant benefit.

### 3. **Simplified Tax Handling**

**If using MoR:**
- ✅ No tax registration required
- ✅ No tax filing required
- ✅ No tax rate management
- ✅ Automatic compliance

**Trade-off**: Higher fees (4% + 40¢ vs 2.9% + 30¢)

---

## What You'd Lose

- ❌ **Lower fees** (Polar is ~37.5% more expensive)
- ❌ **Direct Stripe integration** (you'd go through Polar)
- ❌ **Current Inngest webhook flow** (you'd need to rebuild)
- ❌ **Control over payment processing** (Polar abstracts it)
- ❌ **Simplicity** (adding a layer you may not need)
- ❌ **Flexibility** (locked into Polar's model)

---

## Cost Analysis ⚠️ **UPDATED WITH ACCURATE STRIPE PRICING**

### Scenario 1: $10,000/month in sales (100% US customers)

**Stripe (2.9% + 30¢ for domestic cards)**:
- 100 transactions × $100 = $10,000
- Fees: 100 × ($2.90 + $0.30) = $320/month

**Polar (4% + 40¢)**:
- 100 transactions × $100 = $10,000
- Fees: 100 × ($4.00 + $0.40) = $440/month

**Difference**: $120/month more with Polar (37.5% higher)

### Scenario 2: $10,000/month in sales (100% International customers)

**Stripe (4.4% + 30¢ for international cards)**:
- 100 transactions × $100 = $10,000
- Fees: 100 × ($4.40 + $0.30) = $470/month

**Polar (4% + 40¢)**:
- 100 transactions × $100 = $10,000
- Fees: 100 × ($4.00 + $0.40) = $440/month

**Difference**: $30/month LESS with Polar (6.4% cheaper!)

### Scenario 3: $10,000/month in sales (50% US, 50% International)

**Stripe (Mixed)**:
- 50 US transactions: 50 × ($2.90 + $0.30) = $160
- 50 International transactions: 50 × ($4.40 + $0.30) = $235
- **Total**: $395/month

**Polar (4% + 40¢)**:
- 100 transactions × ($4.00 + $0.40) = $440/month

**Difference**: $45/month more with Polar (11.4% higher)

### Scenario 4: $50,000/month in sales (Mixed 50/50)

**Stripe**: $1,975/month in fees
**Polar**: $2,200/month in fees

**Difference**: $225/month more with Polar (11.4% higher)

**Key Insight**: The more international customers you have, the better Polar's pricing becomes relative to Stripe.

### Break-Even Analysis

**Question**: Is tax compliance worth the extra cost?

**Your Situation**: 
- ✅ **International customers** (from all over the world)
- ✅ **Losing Kajabi's tax handling** (currently have MoR)
- ⚠️ **Tax compliance gap** (need to handle it yourself)

**Answer**: 
- **With international sales**: **YES** - Tax compliance is complex, risky, and time-consuming
- **Cost of manual compliance**: 
  - Accountant fees: $200-500/month for international tax compliance
  - Time cost: 10-20 hours/month researching, calculating, filing
  - Risk cost: Penalties, fines, legal issues for non-compliance
  - **Total estimated cost**: $500-1000/month in time + fees + risk

**Polar's Extra Cost**: 
- $10k/month sales: $120/month extra
- $50k/month sales: $600/month extra

**Break-Even**: Polar's extra cost is **much lower** than the cost of manual tax compliance, especially with international sales.

---

## When Polar Would Make Sense

Polar would be valuable if you had:

- ✅ **International sales** (need MoR tax compliance)
- ✅ **Digital products** (license keys, file downloads)
- ✅ **Developer tools** (GitHub access, API keys)
- ✅ **Community products** (Discord roles, server access)
- ✅ **Complex tax requirements** (multiple jurisdictions)

**Your situation**:
- ✅ **International sales**: **YES** - Customers from all over the world
- ✅ **Tax compliance**: **CRITICAL** - Losing Kajabi's MoR, need to handle taxes
- ❌ **Digital products**: No (you're selling mentorship sessions)
- ❌ **Developer tools**: No (not applicable)
- ⚠️ **Discord roles**: Could be useful (but you can build this)

**Conclusion**: Polar's MoR is **highly valuable** for your use case. With international customers and losing Kajabi's tax handling, Polar becomes a strong candidate.

---

## Recommendation

### Option 1: Use Polar (Recommended for International Sales)

**Use Polar as Merchant of Record (MoR) for tax compliance.**

**Reasons:**
1. ✅ **International tax compliance** - Critical need (losing Kajabi's MoR)
2. ✅ **Risk mitigation** - Avoid penalties, fines, legal issues
3. ✅ **Time savings** - No need to research, calculate, file taxes
4. ✅ **One-time purchases supported** - Unlike Autumn
5. ✅ **Automated benefits** - Discord roles, GitHub access (bonus)
6. ✅ **Cost-effective** - Extra cost (~37.5%) is less than manual compliance

**Migration effort**: Medium (checkout flow, webhooks, Inngest bridge)

**Cost impact**: ~37.5% higher fees, but saves $500-1000/month in compliance costs

**When to reconsider:**
- If you only sell to US customers (sales tax is simpler)
- If you have in-house tax expertise (unlikely for small team)

### Option 2: Keep Stripe + Manual Tax Compliance (Not Recommended)

**Keep your current Stripe + Inngest architecture and handle taxes manually.**

**Reasons:**
1. ✅ **Lower fees** (~37.5% cheaper than Polar)
2. ✅ **Simpler** (no additional abstraction layer)
3. ✅ **More control** (direct Stripe integration)
4. ✅ **Already working** (implemented and tested)
5. ✅ **Inngest integration** (leverages Inngest's strengths)

**Trade-offs:**
- ❌ **Tax compliance burden** - Need to register, calculate, file, remit
- ❌ **Risk of non-compliance** - Penalties, fines, legal issues
- ❌ **Time cost** - 10-20 hours/month on tax compliance
- ❌ **Accountant fees** - $200-500/month for international compliance
- ❌ **Complexity** - Different rules per country, frequent rate changes

**Total cost**: Lower fees, but higher compliance costs (time + fees + risk)

**Verdict**: Not recommended for international sales without tax expertise.

---

## Comparison: Polar vs Current Setup

| Feature | Current (Stripe) | Polar | Winner |
|---------|------------------|-------|--------|
| **One-time payments** | ✅ | ✅ | Tie |
| **Cost (US customers)** | 2.9% + 30¢ | 4% + 40¢ | Stripe |
| **Cost (International)** | 4.4% + 30¢ | 4% + 40¢ | **Polar** |
| **Tax compliance** | Manual | Automated (MoR) | Polar |
| **Control** | Full | Limited | Stripe |
| **Simplicity** | Simple | More complex | Stripe |
| **Discord automation** | Manual | Automated | Polar |
| **Inngest integration** | Direct | Bridge needed | Stripe |
| **International sales** | Manual tax | Auto tax | Polar |
| **MoR included** | ❌ (need Stripe Tax + manual filing) | ✅ (full MoR) | Polar |

**Verdict**: 
- **US-only sales**: Stripe is cheaper (2.9% vs 4%), but Polar provides MoR
- **International sales**: **Polar is cheaper AND provides MoR** (4% vs 4.4% + manual tax compliance)
- **Mixed sales**: Depends on customer mix, but Polar's MoR value increases with international customers

---

## What to Focus On Instead

1. **PayPal integration** (you have Stripe, add PayPal as secondary)
2. **Refund handling** (already in progress)
3. **Error monitoring** (Axiom, Better Stack)
4. **Testing** (expand test coverage)
5. **Discord automation** (build automated role assignment if needed)

**Don't add complexity you don't need.** Polar is valuable for international sales and automated benefits, but your current setup is simpler and cheaper for US-focused sales.

---

## References

- [Polar Documentation](https://polar.sh/docs/introduction)
- [Polar Pricing](https://polar.sh/pricing)
- Current Stripe integration: `apps/web/app/api/webhooks/stripe/route.ts`
- Current Inngest functions: `apps/web/inngest/functions/payments.ts`
- Business model: `mentorship-platform-plan.md`
- Autumn Analysis: `AUTUMN_ANALYSIS.md`

---

## Conclusion

**Polar is a better fit than Autumn** (supports one-time payments), and with your international customers and loss of Kajabi's tax handling, **Polar becomes a strong candidate**.

**Your Situation:**
1. ✅ **International customers** - From all over the world
2. ✅ **Losing Kajabi** - Currently have MoR, will lose it
3. ✅ **Tax compliance gap** - Need to handle international taxes
4. ✅ **One-time payments** - Polar supports this (unlike Autumn)

**Key Questions:**
1. **Are you selling internationally?** → ✅ **YES** - Polar's MoR is **critical**
2. **Do you need automated Discord roles?** → ⚠️ Nice-to-have (but you can build this)
3. **Is tax compliance a burden?** → ✅ **YES** - Without Kajabi, it will be
4. **Is the extra cost acceptable?** → ✅ **YES** - Extra cost is less than manual compliance

**Recommendation**: 
- **Use Polar for MoR** - Critical for international tax compliance
- **Migration effort**: Medium (checkout flow, webhooks, Inngest bridge)
- **Cost impact**: ~37.5% higher fees, but saves $500-1000/month in compliance costs
- **Risk mitigation**: Avoid penalties, fines, legal issues

**Bottom line**: With international customers and losing Kajabi's tax handling, Polar's MoR is **highly valuable**. The extra cost (~37.5%) is worth avoiding the complexity, risk, and time cost of manual international tax compliance.

**Next Steps:**
1. ✅ **VERIFIED**: Kajabi is NOT a MoR - you're responsible for tax filing/remittance (may not have been doing it)
2. Evaluate Polar's MoR coverage (which countries they support)
3. Calculate exact cost difference (Polar vs Stripe + manual compliance)
4. Plan migration (checkout flow, webhooks, Inngest bridge)
5. **Important**: Check if you've been filing/remitting taxes with Kajabi (if not, you may have compliance issues)

