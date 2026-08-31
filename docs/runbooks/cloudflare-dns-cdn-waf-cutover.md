# Cloudflare DNS / CDN / WAF Cutover Runbook

> Runbook for putting the Vercel-hosted `apps/platform` and `apps/huckleberry-drive`
> deployments behind Cloudflare's DNS, CDN, and WAF. Follow this runbook when
> onboarding a new environment (staging first, then production) and during
> any DNS- or WAF-related incident.
>
> This is a **documentation-only** change. It introduces no application code.
> All steps operate against the Cloudflare dashboard, the Cloudflare API, and
> the existing Vercel project DNS records.

## Goals

1. Put Cloudflare in front of every public hostname for `apps/platform` and
   `apps/huckleberry-drive` so the WAF, DDoS protection, and CDN cache apply
   to all traffic.
2. Keep Vercel as the origin. No application code or hosting topology changes.
3. Establish a repeatable, reviewable cutover (staging → production) with a
   pre-tested rollback.

## Non-Goals

- Migrating storage from Backblaze B2 to R2 (Option 1, deferred).
- Replacing the Worker project. The Worker continues to receive direct traffic
  via `NEXT_PUBLIC_EDGE_FUNCTIONS_URL`; this runbook only adds Cloudflare in
  front of the public hostnames.
- Adding new WAF features beyond the recommendations below.

## Audience

Operators with Cloudflare account access (zone-edit, DNS-edit) and Vercel
project access (DNS records, domains). Both staging and production require
a second reviewer for any change that flips proxy status or moves DNS records.

---

## 1. Inventory of Production and Staging Domains

Before any cutover, capture the current state of every domain that will move
behind Cloudflare.

### Apps in scope

| App | Vercel project | Public hostnames (example) |
|-----|----------------|---------------------------|
| `apps/platform` | `<VERCEL_PLATFORM_PROJECT>` | `platform.example.com`, `app.example.com` |
| `apps/huckleberry-drive` | `<VERCEL_HUCKLEBERRY_PROJECT>` | `drive.example.com`, `share.example.com` |
| `apps/web` (legacy, out of scope) | `<VERCEL_WEB_PROJECT>` | `www.example.com` |
| `apps/marketing` (out of scope) | `<VERCEL_MARKETING_PROJECT>` | `marketing.example.com` |

> Replace `<...>` placeholders with the actual project and hostnames for the
> environment being onboarded. Do **not** commit real domain names or project
> IDs into this runbook — copy them from the Vercel dashboard or Cloudflare
> account at execution time.

### What to record per environment

For each environment (staging, production), record the following in the
incident tracker / runbook execution log, not in git:

- Cloudflare account ID
- Vercel team and project IDs
- DNS provider (Vercel DNS or external registrar)
- Current DNS records (A, AAAA, CNAME) for each public hostname
- Current SSL/TLS provider (Let's Encrypt via Vercel, custom cert, etc.)
- Whether the hostnames are currently behind any CDN (Cloudflare, Fastly, etc.)
- Whether the origin is reachable on HTTPS from the public internet

### Email-related hostnames (do not proxy)

If any hostname serves SMTP/IMAP/POP3 traffic (MX target, `mail.*`,
`autodiscover.*`), it must remain **DNS-only** in Cloudflare. Cloudflare's HTTP
proxy cannot proxy mail protocols. Record these explicitly so the cutover does
not accidentally proxy them.

---

## 2. Cloudflare Zone Setup

### Choose the setup type

| Plan | Setup | Notes |
|------|-------|-------|
| Free or Pro | Primary setup (full) | Recommended. Move authoritative DNS to Cloudflare. |
| Business or Enterprise | Primary or CNAME (partial) | Use primary if you can move nameservers; otherwise CNAME if you must keep your registrar. |

For this project, **use a primary setup (full)** unless the domain registrar
cannot be changed. A primary setup gives full DDoS protection on DNS, simpler
record management, and Universal SSL for the apex.

### Create the zone

For each environment's apex domain (e.g. `example.com`):

1. In the Cloudflare dashboard, click **Add a Site** and enter the apex domain.
2. Select the **Free** plan (Pro is fine if available; Business/Enterprise are
   only required if you want CNAME setup or zone transfers).
3. Cloudflare will scan for existing DNS records. Review the scan output and
   confirm every record matches the inventory from section 1.
4. Cloudflare assigns two nameservers (e.g. `anna.ns.cloudflare.com`,
   `bob.ns.cloudflare.com`). Record these.
5. At the registrar, replace the existing nameservers with the Cloudflare
   nameservers. Allow up to 24–48 hours for propagation; in practice the TTL
   of the existing NS records determines the actual cutover time.

### Verify the zone is active

```bash
dig NS example.com +short
# Expect: anna.ns.cloudflare.com., bob.ns.cloudflare.com.
```

```bash
dig SOA example.com +short
# Expect a Cloudflare SOA record.
```

Do not proceed to section 3 until both queries return Cloudflare nameservers
from a neutral resolver (e.g. `1.1.1.1` or `8.8.8.8`).

---

## 3. DNS Record Migration Checklist

For each environment, work through these steps per hostname. Always cut over
**staging first** (see section 7).

### 3.1 Capture the origin target

For each hostname in scope:

1. In Vercel, open the project's **Domains** page.
2. Record the current target. For a CNAME, this is usually
   `cname.vercel-dns.com` (or the project's specific Vercel CNAME).
3. Confirm the target resolves to a Vercel IP range.

### 3.2 Add Cloudflare records

Add (or update) one A or CNAME record per hostname in the Cloudflare dashboard
**DNS → Records**:

| Hostname | Type | Target | Proxy status |
|----------|------|--------|--------------|
| `platform.example.com` | CNAME | `cname.vercel-dns.com` | **Proxied** (orange cloud) |
| `app.example.com` | CNAME | `cname.vercel-dns.com` | **Proxied** (orange cloud) |
| `drive.example.com` | CNAME | `cname.vercel-dns.com` | **Proxied** (orange cloud) |
| `share.example.com` | CNAME | `cname.vercel-dns.com` | **Proxied** (orange cloud) |
| `mail.example.com` | A | `<MAIL_PROVIDER_IP>` | **DNS only** (grey cloud) |
| `example.com` (apex) | A | `<VERCEL_APEX_IP>` | **Proxied** (orange cloud) |

> Replace targets with the actual values for the environment. Use **CNAME
> flattening** if the apex must point to a Vercel hostname. Cloudflare
> auto-flattens CNAMEs at the apex when proxied.

### 3.3 Remove the old records

After the Cloudflare records are added and the nameservers have propagated
(section 2), remove any duplicate A/AAAA/CNAME records at the previous DNS
provider. Keep the records at Cloudflare as the single source of truth.

### 3.4 Sanity checks

```bash
# Should resolve to a Cloudflare IP (not a Vercel IP).
dig +short platform.example.com

# Should return a Cloudflare-assigned ray ID (proves traffic went through Cloudflare).
curl -sI https://platform.example.com | grep -i '^cf-ray:'
```

---

## 4. SSL/TLS Configuration

### 4.1 Choose the encryption mode

| Mode | Origin cert required | Use when |
|------|----------------------|----------|
| **Full (strict)** | Yes — valid public cert or Cloudflare Origin CA | **Use this for production.** Verifies the origin certificate is valid. |
| Full | No (any cert accepted) | Temporary staging only; never use in production. |
| Flexible | No HTTPS at origin | **Do not use.** Origin traffic is unencrypted. |

### 4.2 Production setup (Full strict)

1. Confirm Vercel issues a publicly trusted certificate for every hostname.
   Vercel does this automatically via Let's Encrypt once a domain is assigned
   to the project. Verify in the Vercel dashboard.
2. In Cloudflare **SSL/TLS → Overview**, set the encryption mode to
   **Full (strict)**.
3. Enable **Always Use HTTPS** under **SSL/TLS → Edge Certificates**.
4. Enable **HTTP Strict Transport Security (HSTS)** with `max-age=31536000;
   includeSubDomains; preload`. Only enable after confirming every subdomain
   serves HTTPS reliably. Add to the [HSTS preload list](https://hstspreload.org/)
   once stable.
5. Enable **Minimum TLS Version = TLS 1.2** (default is fine; do not lower
   to TLS 1.0 or 1.1).
6. Enable **Opportunistic Encryption** and **Onion Routing** if desired
   (both are safe defaults).

### 4.3 Staging setup

Use **Full** (not strict) in staging so test certs work without Let's Encrypt
DNS-01 challenges. Promote to **Full (strict)** once production is cut over.

### 4.4 Universal SSL

Cloudflare provisions a Universal SSL certificate automatically once the zone
is active. For subdomains that need a wildcard or a specific SAN list, use
**SSL/TLS → Edge Certificates → Advanced Certificate Manager** to create an
advanced certificate with delegated DCV.

---

## 5. WAF Recommendations

Apply the recommendations below **in staging first**, observe Security
Events for at least 24 hours, then promote to production.

### 5.1 Always-on protections (no action required)

- **DDoS protection** (L3, L4, L7) is always on for every Cloudflare zone.
- **Cloudflare Managed Ruleset** (formerly CF Managed Ruleset) is enabled by
  default. Leave it enabled.
- **OWASP Core Ruleset** is opt-in. Enable it with **Paranoia Level 2** for
  production. Level 3+ increases false positives; tune exceptions.

### 5.2 Bot management

| Plan | Recommended setting |
|------|---------------------|
| Free | Enable **Bot Fight Mode**. Challenges known bots. |
| Pro | Enable **Super Bot Fight Mode**. Allows verified bots (search engines) and challenges the rest. |
| Business / Enterprise | Same as Pro, plus consider **Bot Management** for granular scoring. |

### 5.3 Rate limiting rules

Add the following rate limiting rules (under **Security → Security Rules →
Rate limiting rules**). Start with **Log** action to measure, then switch to
**Block** or **Managed Challenge** once the false-positive rate is acceptable.

| Path / pattern | Threshold | Action | Notes |
|----------------|-----------|--------|-------|
| `POST /api/shared/*` and `POST /shared/*` (Worker) | 10 req / 1 min / IP | Managed Challenge | Share-link downloads; Turnstile is the primary defense, this is a backstop. |
| `POST /api/files/*/upload/*` and `POST /api/uploads/*` | 20 req / 1 min / IP | Managed Challenge | Upload initiation; protects against bots bypassing Turnstile. |
| `POST /api/auth/*` and `POST /sign-in/*` | 5 req / 1 min / IP | Managed Challenge | Auth endpoints. Combine with leaked-credential check (Pro+). |
| `POST /webhooks/*` (Worker) | 60 req / 1 min / IP | Log only | Worker webhook endpoints (`/webhooks/stripe`, `/webhooks/paypal`, `/webhooks/daily`). These are server-to-server; alert on spikes. |

> The Worker webhook routes are at `/webhooks/*` (no `/api` prefix). After
> moving the Worker into the same zone per section 5.5, the expression
> `http.request.uri.path matches "^/webhooks/.*"` matches the actual routes.
> Adjust thresholds based on observed traffic. Use **IP + JA4 fingerprint**
> as the counting characteristic where available for more accurate
> fingerprinting.

### 5.4 Custom WAF rules

Recommended custom rules (under **Security → Security Rules → Custom rules**):

1. **Geo block list** (optional): block countries you do not serve. Use with
   care — geo data is not reliable for fraud prevention.
2. **Bot allowlist** for known good bots (e.g. uptime monitors,
   `cf.client.bot` with verified category). Skip Super Bot Fight Mode for
   these via a _Skip_ action.
3. **API shield**: enable **API Shield → Sequence Mitigation** for any
   authenticated API endpoint that is not idempotent.
4. **Leaked credentials check** (Pro+): enable for sign-in endpoints.

### 5.5 Worker hostname coverage

The Cloudflare Worker (`apps/edge-functions`) is deployed behind
`NEXT_PUBLIC_EDGE_FUNCTIONS_URL`. If that URL is a `*.workers.dev` hostname,
it lives in a separate Cloudflare zone and the zone-level rules in this
runbook will **not** inspect requests to the Worker. To make the zone-level
WAF and rate limiting rules cover the Worker as well:

1. Add a custom domain for the Worker in the same Cloudflare zone as the
   apps (e.g. `edge.example.com`).
2. Update `wrangler.jsonc` to include a `routes` entry for that domain
   bound to the same zone.
3. Update `NEXT_PUBLIC_EDGE_FUNCTIONS_URL` to the new custom domain in
   both `apps/platform` and `apps/huckleberry-drive` env.
4. The zone-level rate limits in section 5.3 will then cover the Worker
   share-download and webhook routes.

If keeping `*.workers.dev` is required (e.g. for staged rollouts), add
**Worker-level** rate limiting as defense-in-depth:

- Add a KV-backed rate limit counter keyed by client IP for the
  `/shared/:token`, `/webhooks/*`, and `/internal/*` routes.
- Throttle at the same thresholds as the zone-level rules (10 / 1 min for
  share downloads; 60 / 1 min for webhooks).
- This is a code change in `apps/edge-functions`, not a Cloudflare config
  change, and is tracked separately from this runbook.

> Treat zone-level rate limits as the primary defense **only** after the
> Worker hostname is moved into the same zone. Until then, Worker-level
> rate limiting is the only effective layer.

### 5.6 Turnstile and Bot Fight Mode interaction

Turnstile is already used in `apps/platform` and `apps/huckleberry-drive`
(PRs #744, #745). Cloudflare's **Super Bot Fight Mode** and **Bot Fight
Mode** may also challenge legitimate users. The combined experience is
acceptable; if false positives appear, add a **Skip** custom rule for paths
already protected by Turnstile (`/api/shared/*`, `/api/uploads/*`).

---

## 6. Cache Rules (Cache / Page Rules)

Cloudflare's CDN cache applies by default to static assets (CSS, JS, images,
fonts) based on file extension. Add explicit Cache Rules for app-specific
behavior.

### 6.1 Recommended cache rules

| Rule | Expression | Cache eligibility | TTL |
|------|------------|-------------------|-----|
| Static assets | `http.request.uri.path matches "\\.(js|css|woff2?|png|jpe?g|svg|webp|avif)$"` | Eligible | 1 year |
| Next.js image optimizer | `http.request.uri.path eq "/_next/image"` | Eligible | 1 day |
| Public marketing pages | `http.request.uri.path in {"/" "/pricing" "/about"}` | Eligible | 1 hour |
| App pages (authenticated) | default | **Bypass** | — |

> The default rule is deliberately **Bypass** (not Eligible). Only the
> three explicitly listed Eligible rules cache content; everything else,
> including `/dashboard`, `/workspace/*`, `/uploads`, `/shared/*`, and
> any unmatched route, is bypassed. This avoids accidentally caching
> authenticated or user-specific pages.
>
> Replace the public marketing page list with the actual pages for your
> project. Any path under `/api/*`, `/admin/*`, `/instructor/*`, or
> `/student/*` should **bypass cache**.

### 6.2 Ruleset order

In the Cloudflare dashboard, order matters: rules are evaluated top-to-bottom
and the first match wins. Place the most specific rules first:

1. API and authenticated routes — **Bypass**.
2. Static assets — **Eligible**, long TTL.
3. Image optimizer — **Eligible**, medium TTL.
4. Marketing pages — **Eligible**, short TTL.
5. Default — **Bypass** so any unmatched application route (e.g. `/dashboard`,
   `/workspace/*`, `/uploads`, `/shared/*`) is not cached. Only the
   explicitly listed eligible rules above cache content; the default is
   deliberately conservative.

### 6.3 Origin Cache-Control

Cloudflare honors origin `Cache-Control` headers. Verify Vercel's Next.js
config emits sensible cache headers:

- Static assets: `public, max-age=31536000, immutable`.
- Image optimizer: `public, max-age=86400`.
- HTML pages: `private, no-cache`.

If the origin returns `no-store` or `private`, Cloudflare will not cache it
even if a Cache Rule says eligible. Tune the Next.js config before relying
on Cache Rules.

---

## 7. Staging Cutover Plan

Always cut over **staging first** and observe for at least 48 hours before
touching production.

### 7.1 Pre-cutover checklist

- [ ] All inventory recorded (section 1).
- [ ] Staging Cloudflare zone created (section 2).
- [ ] Staging DNS records added and verified (section 3).
- [ ] Staging SSL/TLS set to **Full** (section 4.3).
- [ ] Staging WAF rules deployed in **Log** mode (section 5).
- [ ] Staging Cache Rules deployed (section 6).
- [ ] Second reviewer assigned.
- [ ] Incident tracker entry created.

### 7.2 Cutover steps

1. **Flip proxy status** for each staging hostname from **DNS only** to
   **Proxied** in Cloudflare **DNS → Records**.
2. **Verify**: `curl -sI https://<staging-host>` shows a `cf-ray` header.
3. **Verify HTTPS**: confirm `Always Use HTTPS` redirects `http://` to
   `https://` correctly.
4. **Smoke test**: run the critical-path smoke test suite against the
   staging hostname. At minimum:
   - Sign in / sign out.
   - Open the workspace dashboard.
   - Upload a file.
   - Generate a share link and download it (exercises the Worker route).
   - Trigger a Stripe test webhook (use the Stripe CLI).
5. **Observe for 48 hours** with all WAF rules in **Log** mode. Review
   Security Events for false positives. Tune custom rules.
6. **Promote rules**: switch WAF rules from **Log** to **Managed Challenge**
   or **Block** based on the observed false-positive rate.
7. **Promote SSL/TLS** to **Full (strict)** once the staging origin cert
   has been verified.

### 7.3 Acceptance criteria

A staging cutover is considered successful when:

1. `curl -sI https://<staging-host>` returns `cf-ray` and a `200`/`301`/`302`
   for every public hostname.
2. `curl -I https://<staging-host>` returns `server: cloudflare`.
3. The smoke test suite passes against the staging hostname.
4. Security Events show no false-positive blocks of legitimate users over
   the 48-hour observation window.
5. The Cloudflare analytics dashboard shows traffic matching the Vercel
   request volume for the same period (within ±5%).

---

## 8. Production Cutover

Repeat the staging plan against production, with the following differences:

1. Schedule the cutover during low-traffic hours.
2. Use **Full (strict)** SSL/TLS from day one (section 4.2).
3. Enable HSTS and add to the preload list once stable.
4. Promote WAF rules to **Block** rather than **Managed Challenge** for
   rate limiting (the trade-off is more false positives, fewer challenges).
5. Have a second operator watching the Cloudflare dashboard and Vercel
   logs in real time during the cutover.
6. Run the full smoke test suite and a synthetic transaction (sign up,
   upload, share, download) within 30 minutes of the cutover.

---

## 9. Rollback Plan

If the staging cutover fails, or any production cutover step causes
regressions, follow this rollback procedure.

### 9.1 Rollback within Cloudflare (preferred)

1. In **DNS → Records**, flip every proxied hostname back to **DNS only**
   (grey cloud). This routes traffic around Cloudflare to the existing
   Vercel origin targets.
2. Disable any custom WAF rules that may be blocking traffic
   (set action to **None**).
3. Disable Cache Rules (or set to **Bypass**).
4. Re-enable **Development Mode** under **Caching → Configuration** to
   bypass cache for all traffic during diagnosis.

### 9.2 Rollback to the original DNS provider (nuclear)

If Cloudflare itself is unreachable or misbehaving:

1. At the registrar, restore the original nameservers (the ones recorded
   in section 1).
2. Wait for DNS propagation (TTL of the old NS records).
3. Verify with `dig NS example.com` that the old nameservers are active.
4. Open an incident with Cloudflare support.

### 9.3 Rollback time

| Action | Expected cutover |
|--------|------------------|
| Flip proxy status to DNS only | Seconds (Cloudflare internal) |
| Restore original nameservers | 5 minutes – 48 hours (TTL) |

The **Cloudflare-only rollback** (9.1) is the default. The registrar-level
rollback (9.2) is only needed if Cloudflare is itself the failure source.

### 9.4 Post-rollback

After any rollback:

1. Capture the failure mode and false-positive logs in the incident tracker.
2. Tune the offending rule or DNS record.
3. Re-attempt the cutover after at least 24 hours of stable DNS.

---

## 10. Monitoring and Alerting

After the cutover, set up the following alerts in Cloudflare
(**Notifications**):

- **5xx error rate** from origin above 1% over 5 minutes → page on-call.
- **WAF block rate** above 5% of total requests → notify security on-call.
- **Rate limit rule** triggering above N times per minute → notify ops.
- **SSL/TLS cert expiry** within 30 days → notify ops (Universal SSL auto-
  renews, but advanced certs may not).
- **DDoS attack detected** (L7) → page on-call.

Also add a Cloudflare analytics dashboard with:

- Requests per second by hostname.
- Cache hit ratio (target: >80% for static assets).
- Top WAF rule triggers.
- Top countries and ASNs.

---

## 11. Appendix: Cloudflare API Examples

For IaC or scripted cutovers, use the Cloudflare API. Required token
permissions: `Zone Zone Edit`, `Zone DNS Edit`, `Zone WAF Edit`,
`Zone Cache Purge`, `Zone Settings Edit`.

### Create a zone

```bash
curl "https://api.cloudflare.com/client/v4/zones" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "name": "example.com",
    "account": { "id": "<CLOUDFLARE_ACCOUNT_ID>" },
    "type": "full"
  }'
```

### Add a proxied CNAME record

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "type": "CNAME",
    "name": "platform.example.com",
    "content": "cname.vercel-dns.com",
    "proxied": true
  }'
```

### Set SSL mode to Full (strict)

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  --request PATCH \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{ "value": "strict" }'
```

### Purge cache (after a deploy)

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{ "purge_everything": true }'
```

> Replace `$ZONE_ID` and `$CLOUDFLARE_API_TOKEN` with real values from the
> secrets manager. Never commit real zone IDs or API tokens into git.

---

## 12. Appendix: Naming and Secrets

Per repo policy:

- Use `instructor` and `student` in any code or config that references roles.
- Never commit real Cloudflare keys, zone IDs, Vercel tokens, or domain names
  into this runbook or any other file in the repo. Use placeholders like
  `<CLOUDFLARE_ACCOUNT_ID>` and `<VERCEL_PLATFORM_PROJECT>`.
- Treat the Cloudflare API token like any other secret: store in the secrets
  manager, rotate quarterly, scope to least privilege.
