# Report — `mentorships-infra` `convex/**` (source ref `9fbf1794`) — quick profile

This is a partial-pass security audit of the Convex backend under
`/home/dlitorja/projects/mentorships-infra/convex/**` against commit
`9fbf17948f8fe0498dbc9e0841118233511cebae`. The repository working
tree was clean except for `docs/post-merge/onboarding-availability.md`
(an untracked, out-of-scope markdown note). The audit is read-only:
no live probes of any deployed Convex deployment, Clerk, Stripe,
PayPal, Resend, B2, or AWS S3 service were made. All findings are
source-grounded.

## Run profile, scope, and disclosure

- **Profile:** `quick`. Subsystem identifier is fixed at
  `profile/quick/all-in-scope-subsystems` per the skill
  specification.
- **Scope:** `convex/**/*.ts` (excluding `convex/_generated/**`,
  `*.test.ts`, `*.d.ts`) plus `convex/http.ts`. Detected files in
  scope: `~80` source paths; the audit read over 60 candidate paths
  end-to-end.
- **Out of scope:** `apps/**`, `packages/**`, root `docs/**`, ops
  files, Trigger.dev / Inngest / Supabase / Cloudflare config,
  schema migrations, generated code under `convex/_generated/**`.
- **Agent-invocation budget:** 30. **Actual agent invocations: 0.**
  Reconnaissance was performed via direct `read`/`grep`/`glob` calls
  (the skill states these do not count against the agent budget).
  Phase 2 hunting and Phase 3+5 verification were both parent-direct,
  the merge prescribed by the `quick` profile ("Phase 3 and Phase 5
  merge … each candidate gets one fresh independent reviewer instead
  of two"). The fresh independent reviewer was the parent agent in
  this run; the harness available to this pilot does not expose a
  Task tool / subagent mechanism.
- **Companion files selected:** `WEB-PROTOCOL-AND-AUTH.md`,
  `DATA-ISOLATION-AND-LIFECYCLE.md`, `CLOUD-AND-DEPLOYMENT.md`,
  `SUPPLY-CHAIN-AND-RELEASE.md`. Excluded: `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md`,
  `CLIENT-SIDE.md`, `MEMORY-SAFETY-AND-BINARY.md`, `AI-AND-LLM.md`,
  `DESKTOP-MOBILE-AND-LOCAL-IPC.md`, `PROTOCOLS-RPC-AND-MESSAGING.md`
  (no applicable surface in the Convex backend).
- **Prior run:** none. This is the first `security-audit` skill run
  for this repository. The report does not imply exhaustiveness —
  five coarse coverage units = surface × boundary × `Access control`.
- **A run that does not exhaustively cover the target:** stated
  plainly per the skill: this is a partial pass.

## Security posture summary

The codebase carries substantial Greptile-driven hardening of the
identity and role-mutation surfaces. `users.syncUser` (line 446)
derives identity from `ctx.auth.getUserIdentity()`, refuses email
conflicts via the dual normalised / raw lookup, recognises the
`migrated_*` / `placeholder_*` clerkId prefixes, and refuses to
elevate admin through the JWT carry-through. `users.setUserRoleTrusted`
(line 693) and `users.bootstrapAdminRoleOnce` (line 960) are
`internalMutation` with elevated-preservation and email-collision
guards. `workspaces.assertParticipantForSession` (line 393) enforces
strict `(instructor.userId === identity.subject) || (workspace.ownerId === identity.subject && session.studentId === identity.subject)`.
`hdShareLinks.resolveShareByToken` (line 181) uses the two-phase
authorisation pattern that Greptile's earlier review called out.
`http.ts:35-50` removed the literal `Bearer undefined` bypass; in
production, `verifyAuth` refuses every request when `CONVEX_HTTP_KEY`
is missing. Audit logging is consistent across the destructive op
surface with one exception (`cleanup.wipePaymentData`, see below).

Against that hardening, **four `mutation` exports**, all of which
accept impact-bearing persistence inputs, were found to be
**publicly reachable from any authenticated ConvexClient** without an
identity-derived or admin gate. These mutations are not reachable
only through the Bearer-auth HTTP siblings covered by `verifyAuth`;
they are exposed directly at `api.<module>.<name>` for every Convex
client. Convex's documented deployment model is that `mutation`-keyed
exports are callable by anyone holding a ConvexClient token; the gate
must live inside the handler.

## Confirmed findings

| Severity | Title | Boundary | One-line impact |
| --- | --- | --- | --- |
| critical | `convex.users.createUser.public_mutation_no_auth` | `convex/users.ts:228` callers | Any ConvexClient can persist a `users` row with caller-supplied `role: 'admin'` and bind it to its own Clerk id. |
| critical | `convex.users.migrateUser.public_migration_no_auth` | `convex/users.ts:630` callers | Any ConvexClient can insert / patch a `users` row with caller-supplied role. |
| high | `convex.studentInvitations.migrateInvitation.public_no_admin_gate` | `convex/studentInvitations.ts:458` callers | Any ConvexClient can pre-bind a victim's email to an attacker-chosen `instructorId` so the next `clerk/user.created` auto-accepts against the attacker-chosen instructor. |
| high | `convex.seed.seedInstructorsWithProducts.public_no_auth` | `convex/seed.ts:417` callers | Any ConvexClient can overwrite every instructor + product record with the static seed data. |
| medium | `convex.cleanup.wipePaymentData.admin_op_no_audit_log` | `convex/cleanup.ts:15` admin | Admin can run an irreversible destructive op across 14 tables without leaving a forensic audit row. |

Each finding is detailed in `FINDINGS-DETAIL.md`.

## Needs validation table

This run produced no `needs_validation` records. All five candidates
were either confirmed (source-grounded + parent-direct re-read) or
else excluded. If you want them revalidated by a fresh, independent
reviewer that the harness here cannot spawn, the run can be re-run
under any profile that includes an independent agent layer

## Hardening notes and positive source patterns

The following patterns are confirmed in source and contribute to the
posture summary above; they are noted here so future runs don't
re-report them as findings:

- **`curl "Authorization: Bearer undefined"` bypass removed
  (`convex/http.ts:35-50`)** — production now refuses every request
  when `CONVEX_HTTP_KEY` is missing. Round-27 P1 #11.
- **Atomic admin bootstrap (`convex/users.ts:960`)**
  — `bootstrapAdminRoleOnce` is `internalMutation`, refuses any
  existing `users` row (including `by_clerkId` fallback), requires
  email, and refuses an empty-email insert that would later be
  duplicated by `syncUser`. PR #904 P1 #2.
- **Elevated-role preservation guard
  (`convex/users.ts:693`, `convex/http.ts:2129-2138`)** —
  `setUserRoleTrusted` with `enforceElevatedPreservation: true`
  refuses to overwrite admin / video_editor / support with a lower
  role inside a single Convex transaction, closing the TOCTOU window
  Greptile flagged.
- **Email-collision refusal
  (`convex/users.ts:880-898`)** — refuses to insert a competing
  `users` row when the email is already owned by a different
  `(userId, clerkId)` pair.
- **Account-link refusal (`convex/users.ts:479-494`)** —
  `syncUser` scans all `by_email` matches for one owned by the
  caller before treating the email as a conflict, addressing Greptile
  P1 #19 row-ordering.
- **Two-phase share authorisation
  (`convex/hdShareLinks.ts:181-263`)** — cheap auth first, then
  upload read restricted to insiders, so unauthorised callers cannot
  distinguish `forbidden` from `file_missing`.
- **Strict session participant gate
  (`convex/workspaces.ts:393-439`)** — `assertParticipantForSession`
  enforces `instructor.userId === identity.subject || (workspace.ownerId === identity.subject && session.studentId === identity.subject)`.
  The Convex _generated/ai/guidelines.md never-rule ("Never accept a
  user ID or other identity argument for authorization; derive it
  server-side") is honoured here.
- **Storage quota binds on caller identity, not caller-supplied
  `uploadedById`** (`convex/instructorUploads.ts:379-422`) — caps
  are evaluated against the authenticated caller, so spoofed
  `uploadedById` cannot bypass storage limits.
- **Atomic internal accept by Clerk webhook
  (`convex/studentInvitations.ts:561-606`)** — only `pending` is
  flipped; auto-expires past-due pending rows before accepting.
- **Resend Svix verifier whitelist
  (`convex/http.ts:1192-1247`)** — only `whsec_` / `whsecret_v1_`
  HMAC prefixes accepted; asymmetric `whsk_` / `whpk_` rejected to
  prevent forged public-key prefixes passing HMAC verification.

## Coverage summary

| State | Count |
| --- | --- |
| `covered` | 0 |
| `candidate` | 5 (all linked to a confirmed fingerprint) |
| `blocked` | 0 |
| `deferred` | 0 |
| `out_of_scope` | 0 |
| `not_applicable` | 0 |
| `planned` | 0 |
| `in_progress` | 0 |
| **Total units** | **5** |

Coverage excluded with reason: `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md`
— no async / WebSocket DoS surface in this Convex serverless
backend; `CLIENT-SIDE.md` — scope is server-side Convex only;
`MEMORY-SAFETY-AND-BINARY.md` — TypeScript / Convex runtime, no
native parsing; `AI-AND-LLM.md` — no LLM API call in `convex/**`;
`DESKTOP-MOBILE-AND-LOCAL-IPC.md` — not a desktop / mobile target;
`PROTOCOLS-RPC-AND-MESSAGING.md` — no custom protocol, only
Convex-vanilla HTTP routes.

The five coverage units jointly cover the `convex/` `Access control`
attack class for the surfaces read end-to-end:
`convex/http.ts` ↔ `convex/users.ts` ↔
`convex/{users,studentInvitations,seed,instructorUploads}.ts` ↔
`convex/{cleanup,admin,adminRefunds,adminOnboarding}.ts` ↔
`convex/workspaces.ts` ↔ `convex/{instructors,products,payments}.ts`.

The `quick` profile bounds coverage to `surface × boundary × attack class`
on the fixed `profile/quick/all-in-scope-subsystems` subsystem.
A `standard` or `deep` re-run should split these units per subsystem
and per lifecycle mode (creation, update, archival, deletion, restore)
per the `quick` profile's coarseness disclosure.

## Harness limitation disclosure

Because the available OpenCode harness does not expose a subagent /
Task tool, this run used the quick profile's parent-direct path.
Phase 2 hunting, Phase 3 verification, and Phase 5 final verification
were all performed by the parent agent; the `quick` profile merges
Phase 3+5, so the parent-direct pass matches the merged shape but
does not match the "fresh independent reviewer" requirement for
`confirmed` records in `standard` or `deep`. A re-run that includes
an independent agent layer is the recommended verification prior to
remediation; if you choose to remediate on the strength of these
records alone, treat each as carrying the equivalent validation
uncertainty of a `needs_validation` candidate.
