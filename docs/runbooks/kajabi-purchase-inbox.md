# Kajabi purchase inbox (email intake) runbook

> The current Kajabi plan does not expose webhook URLs. This is the fallback:
> Kajabi emails each purchase confirmation to `support@`, Resend receives it,
> and an admin approves the onboarding from a review queue.

## Flow

1. `support@huckleberry.art` is a recipient on each Kajabi offer.
2. The Google Group forwards `support@` to the Resend Inbox receiving address.
3. `kajabi-inbox-sync` polls Resend every 5 minutes (and on the **Sync now**
   button), parses confirmations, and inserts a `pending` row in
   `kajabiPurchaseInbox`.
4. An admin reviews `/admin/kajabi-purchases`, adjusts instructor, sessions,
   and expiry, and clicks **Approve and onboard**.
5. `approveKajabiPurchase` commits the onboarding and marks the purchase
   approved in one transaction, then the existing `adminOnboardingFlow` sends
   the student, instructor, and admin emails.

Nothing is created and no email is sent until an admin approves.

## Resend inbox setup

- Inbox: `support@huckleberry.art`
- Receiving address: the `receiving_address` shown in the Resend Inbox
  (Settings / API). Add it to the `support@` Google Group with **All email**
  delivery. No MX change is needed; the inbox uses Resend forwarding mode.
- Label: **Kajabi Purchase**. The Inbox agent tags confirmations with it, does
  not draft replies to them, and does not archive them.

## Environment

In the `mentorships-infra-platform` Vercel project:

```env
KAJABI_INBOX_RECEIVING_ADDRESS=<resend receiving address>
```

`RESEND_API_KEY`, `CONVEX_HTTP_KEY`, and `NEXT_PUBLIC_CONVEX_URL` are already
required by other platform tasks and are reused by the poll.

## Parser

`apps/platform/lib/kajabi/parse-purchase-email.ts` extracts:

- offer title (from `New purchase for '<title>'`)
- purchase type (`(1-on-1)` → one-on-one, `Group` → group, else unknown)
- instructor name (text before ` - ` in the offer title)
- student name, student email
- Kajabi purchase id and contact id

It handles direct and Gmail-forwarded confirmations. The admin sees the raw
email and can correct the fields before approving.

## Dedupe and retries

- `upsertFromEmail` dedupes on the Resend email id and the Kajabi purchase id.
- `approveKajabiPurchase` is atomic and idempotent: retrying an approved row
  returns its existing onboarding id instead of creating a duplicate.
- If the Inngest event fails after the commit, the row is still approved and
  links to the onboarding; retry the email flow from
  `/admin/onboardings/<id>` (Retry).

## Limitations

- The parser expects Kajabi's "New purchase for '<offer>'" confirmation shape.
  If Kajabi changes the template, update the parser and its unit tests.
- Only one-on-one offers are onboarded today. A group offer is shown as
  `Group`; the admin can still choose an instructor and sessions, but the
  group-specific session model is not implemented yet.
- This path relies on Resend data retention (30 days on the current plan). The
  queue row is stored in Convex once polled.
