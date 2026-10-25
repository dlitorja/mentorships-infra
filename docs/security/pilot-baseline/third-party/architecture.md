# Architecture — mentorships-infra `convex/**` (commit `9fbf1794`)

> Source-controlled read; no live probes. Names follow the repo naming rule
> (`instructor`/`student`, not `mentor`/`mentee`).

## Products and principals

The repository hosts a multi-tenant marketplace in which **instructors**
sell mentorship session packs (one-on-one and group) to **students**. The
backed product is the `Convex` backend under `convex/`; `apps/web`,
`apps/platform`, and `apps/marketing` are Next.js consumers. The Convex
runtime host execution plan executes `convex/http.ts` and the public
`query` / `mutation` / `action` exports from `convex/**/*.ts`.

### Principals surfaced by the Convex auth identity

| Principal | Identity source | Capability domain |
| --- | --- | --- |
| Student | `users.clerkId === ctx.auth.getUserIdentity().subject`; role `student` or legacy `undefined` | Read own data; create / consume session packs; read workspaces they participate in |
| Instructor | `users.clerkId === ctx.auth.getUserIdentity().subject`; role `instructor` + an `instructors` row keyed on `userId` | Profile, products, inventory, sessions, workspace ownership, upload introspection, share-link issuance |
| Video Editor | `users.clerkId === identity.subject`; role `video_editor` + an active `videoEditorAssignments` row | Cross-instructor uploads (scoped by assignment) |
| Admin | `users.role === "admin"` | Platform-wide read; destructive ops; instructor / role bootstrap |
| Support | `users.role === "support"` | Admin-gated product surface (delegated admin actions) |
| System actor (bearer-only) | `Authorization: Bearer <CONVEX_HTTP_KEY>`; resolved via `verifyAuth` in `convex/http.ts:35-70` | Service queue / worker / repair-script jobs |
| Webhook actor (Resend / Clerk) | Svix HMAC over webhook body | Event ingestion wired by `convex/http.ts:1138-1247` (Resend) and `convex/http.ts:1435-1524` (Clerk) |

The Clerk JWT issuer domain is configured in `convex/auth.config.ts`
with a `fallbackIssuerDomains` allowlist (dev / preview / production).

## Stack

- **Language / runtime:** TypeScript on the Convex V8 runtime.
- **Database:** Convex documents with explicit indexes. ~55 `defineTable`
  entries covering users, instructors, sessions, seat reservations,
  session packs, orders, payments, products, bookings, instructor
  testimonials, student results, workspaces (and a long lifecycle of
  related workspace tables), student invitations, user identities,
  instructor uploads, hd share links and access, admin onboarding,
  suppression events, denial domains, video editor assignments, audit
  logs, and reconcile run state.
- **Auth provider:** Clerk (JWT bearer), issuer allowlist pinned in
  `auth.config.ts`.
- **Email:** Resend (transactional + lifecycle), surfaced via shared
  `convex/lib/email` and called from several actions.
- **Object storage:** Backblaze B2 (signed AWS SigV4 inside
  `instructorUploads.ts`) plus optional AWS S3 mirror.
- **Payments:** Stripe and PayPal; refunds via `convex/adminRefunds.ts`.
- **Background jobs:** Convex `ctx.scheduler.runAfter(0, ...)` plus
  Trigger.dev tasks for external side-effects (recording pipeline,
  email sending). Inngest runs legacy flows in `apps/web`.

## Entry surfaces

### Public `query` / `mutation` / `action` exports callable via ConvexClient

Every `query` / `mutation` / `action` exported from `convex/**` is
served by Convex at `/api/query` / `/api/mutation` / `/api/action` for
any caller holding a valid deployment token. Calling them requires
`(convexUrl, deploymentName)` and a Clerk user JWT for the user context
that Convex attaches via `ctx.auth.getUserIdentity()`. Public mutations
that do not read identity or call any `requireXxx` helper are reachable
by every authenticated user; what they can write depends on the
mutation body.

### HTTP routes registered in `convex/http.ts`

84 `http.route` registrations on the router. They split into two auth
modes:

- **Bearer-gated service routes:** `verifyAuth(request)` checks
  `Authorization: Bearer ${CONVEX_HTTP_KEY}`. The previous undefined
  bypass (where a literal `Bearer undefined` matched when the env var
  was unset) was removed; in production the function now refuses every
  request when `CONVEX_HTTP_KEY` is missing or empty.
- **Svix-gated webhook routes:** `httpPostResendWebhook` (Resend) and
  `httpClerkWebhook` (Clerk). Each verifies a Svix HMAC over `${svix-id}.${svix-timestamp}.${rawBody}` with a 5-minute timestamp window. Two prefix families are supported on Resend secrets only (`whsec_`, `whsecret_v1_`); the Clerk handler uses the legacy `verifySvixSignature`.

Notable routes and their dispatch behavior:

| Path | Auth | Mutation / Query |
| --- | --- | --- |
| `/seed/instructor` | Bearer or `/seed/` dev-only flag | `httpSeedInstructor` → `api.instructors.createInstructor` + `api.products.createProduct` + testimonials / student results |
| `/users/create` | Bearer | `httpCreateUser` → public `api.users.createUser` |
| `/admin/sync-inventory` | Bearer | Updates `instructors.inventory` |
| `/webhooks/clerk` | Svix | `user.created` claim via `internal.instructors.linkClerkUserToInstructor` + `internal.adminOnboarding.claimOnboardingByEmail`; `user.deleted` unlink |
| `/resend/webhook` | Svix | Suppression / bounce / complaint upserts into `suppressionEvents` |
| `/internal/link-{session-packs,seat-reservations,workspaces}` | Bearer | Email-to-Clerk-user link migration |
| `/internal/student-invitations/list-pending-by-email` | Bearer | Internal query, not exposed publicly |
| `/internal/student-invitations/accept-by-id` | Bearer | Internal mutation, atomic pending-flip |
| `/users/set-role` | Bearer | `setUserRoleTrusted` (unconditional) |
| `/users/ops-set-role` | Bearer | `setUserRoleTrusted` with `enforceElevatedPreservation` |
| `/instructors/create-for-clerk-user` | Bearer | `createInstructorForClerkUserInternal` |

### HTTP-keyed mutations that bypass identity

`httpCreateInstructorForClerkUser` and `httpServerVerifiedSetUserRole`
both inject `actorId: "platform-server"` and `actorRole: "system"` into
the audit log. This is documented as intentional: the bearer key is the
service-trust boundary. If the key leaks, an attacker can mint
instructors or flip roles without ever touching a ConvexClient identity.

## Controls present

- **Per-function gates:** `requireAdmin`, `requireAdminOrSupport`,
  `requireAdminRole`, `isAdminUser` in `convex/admin.ts`;
  `requireWorkspaceMember` in `convex/workspaces.ts`; the explicit
  `assertParticipantForSession(ctx, { sessionId })` at
  `convex/workspaces.ts:393-439` enforces
  `instructor.userId === identity.subject || (workspace.ownerId === identity.subject && session.studentId === identity.subject)`.
- **Two-phase authorization on `resolveShareByToken`** (`convex/hdShareLinks.ts:181-263`):
  cheap authorization first, then upload read restricted to insiders so
  unauthenticated callers cannot distinguish `forbidden` from `file_missing`.
- **Storage access gates** in `instructorUploads.ts`:
  `requireDeleteAccess` and `requireAdminDeleteAccess`. Uploads are
  scoped to instructor / video-editor / admin with quota
  enforcement for video editors hard-binding on caller identity, not
  caller-supplied `uploadedById`.
- **Atomic admin bootstrap** in `internal.users.bootstrapAdminRoleOnce`
  (refuses both an existing row and an empty-email insert), added to
  close a precondition / write race.
- **Elevated-role preservation guard** in
  `setUserRoleTrusted(enforceElevatedPreservation)` ensures the
  `/users/ops-set-role` endpoint cannot silently overwrite an existing
  admin / video_editor / support role with a lower one.
- **Email-collision guard** in `setUserRoleTrusted` insert path
  refuses to create a competing `users` row when the email is already
  linked to a different `(userId, clerkId)` pair.
- **Account-linking refusal** in `users.syncUser` (`convex/users.ts:466-520`):
  refuses to insert a row when the email is owned by a different
  identity, with raw-email fallback for legacy mixed-case rows.
- **`isOwnedByIdentity`** in `users.ts:352-367` recognises the
  `migrated_` / `placeholder_` clerkId prefixes used by historical
  migration tooling, then `syncUser` upgrades them to the real Clerk
  subject so future syncs take the fast path.
- **Webhook signature hard paths:**
  two independent Svix HMAC verifiers with explicit
  5-minute timestamp window. Resend signing secret prefix whitelists.
- **Workspace role guard `getWorkspaceRole`** is the long-standing
  authority helper used by workspace-scoped queries / mutations.
- **Audit log writes** accompany every privileged mutation
  (`setUserRoleTrusted`, `bootstrapAdminRoleOnce`,
  `adminOnboardStudent`, `acceptStudentInvitationByIdInternal`,
  `processRefundForAdmin`). Audit rows include `actorId` /
  `actorRole`. The `cleanup.ts:15 wipePaymentData` mutation —
  flagged in this run — does NOT yet write an audit row.

## Prior coverage

None. There is no prior `coverage-ledger.json` or `findings.json` from
a prior security-audit run of this repository under this skill. The
report does not assert or imply that this single `quick` pass
exhaustively audits the Convex backend; remaining coverage gaps are
listed in `REPORT.md`.

## Subsystems in scope

Per the `quick` profile, the subsystem identifier is fixed at
`profile/quick/all-in-scope-subsystems`. Coverage units below
coarsen subsystems to *entry surface × attack class*. Attack classes
selected: `web-protocol-and-auth` for the HTTP entry surface and
ConvexClient surfacing of public mutations; `data-isolation-and-lifecycle`
for multi-tenant data lifecycle, destructive ops, and background
tenant scope; `access-control` for identity-derived authorization
gates on role-bearing mutations and queries; `business-logic` for
payment / order / product state machines where the audit found
candidate patterns of interest.
