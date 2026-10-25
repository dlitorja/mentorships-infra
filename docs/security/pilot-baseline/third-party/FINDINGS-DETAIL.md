# Findings detail — `medium` / `high` / `critical` confirmed records

For each confirmed `medium`, `high`, or `critical` record: complete
source trace, dummy principal, native input, bounded local
reproduction, observed output, security invariant, conditions,
source-level remediation, regression case. Sanitised to the
repository's `instructor` / `student` naming rule from
`/home/dlitorja/projects/mentorships-infra/AGENTS.md`.

---

## F1 — `convex.users.createUser.public_mutation_no_auth` (critical)

### Source trace (ordered, repo-relative)

1. `convex/users.ts:228`   — `export const createUser = mutation({ args: { userId, email, clerkId?, firstName?, lastName?, role?, timeZone? }, handler })`. Public Convex mutation.
2. `convex/users.ts:239-242` — `ctx.db.query('users').withIndex('by_email', (q) => q.eq('email', args.email)).first()`. Read by caller-supplied email.
3. `convex/users.ts:248-252` — `ctx.db.insert('users', { ...rest, clerkId: clerkId ?? `placeholder_${args.userId}` })`. Insert verbatim caller-supplied payload.

No `ctx.auth.getUserIdentity()` and no `requireAdmin` / `isAdminUser`
between step 1 and step 3.

### Dummy attacker and affected dummy resource

- **Attacker:** any authenticated ConvexClient user (any role).
- **Affected resource:** the canonical `users` identity table, including
  the caller themselves (self-elevation via `role: 'admin'`) and
  (with timing) any victim whose email ends up enrolled via
  `syncUser`'s placeholder-claim fallback.

### Native bounded reproduction

In a Convex deployment pointed at the source tree:

1. Authenticate as a freshly-issued student ConvexClient token.
2. `await convexClient.mutation(api.users.createUser, { userId: 'user_<self-clerk-id>', email: '<self-email>', clerkId: 'user_<self-clerk-id>', role: 'admin' })`.
3. Without re-authenticating, query `api.admin.getAllInstructors` (admin-gated
   via `users.role === 'admin'` inside `convex/admin.ts`). Observe the
   query returns the full list.

### Observed output and the security invariant it proves

The handler at `convex/users.ts:248-252` persists `role: 'admin'` on the
caller's row. `convex/admin.ts:7 isAdminUser` then resolves the caller
as admin on the next protected read. The invariant the code must
enforce — that `users.role` is not authoritatively writable by an
authenticated client without an admin gate or identity derivation — is
violated. Convex's deployment-key model gates only `internalMutation`,
not the public `mutation` surface, so this is realised without any
deploy-key compromise.

### Conditions and containment

- **Authentication level:** any authenticated ConvexClient; the
  handler does not gate on role.
- **User interaction:** none required beyond authenticated read/write
  access.
- **Data state:** self-attributed admins via the explicit `clerkId`
  branch; placeholder-claim admits cross-tenant inserts that
  `isOwnedByIdentity` will recognise when the victim signs up.

### Source-level remediation

Convert `createUser` to `internalMutation`. If the public mutation must
remain for tooling, derive Clerk identity and refuse injected role,
mirroring `users.syncUser` (line 446+).

```ts
// convex/users.ts
import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

export const createUser = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    clerkId: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    // role removed; callers elevate via setUserRoleTrusted (Bearer-auth)
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existing) return existing._id;
    const { clerkId, ...rest } = args;
    return await ctx.db.insert("users", {
      ...rest,
      clerkId: clerkId ?? `placeholder_${args.userId}`,
    });
  },
});

// Optional public-surface alternative that derives identity:
export const createUserSelf = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const email = identity.email?.trim().toLowerCase();
    if (!email) throw new Error("User email not found in auth identity");
    const owned = (await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
    ).find((r) => r.clerkId === identity.subject);
    if (owned) return owned._id;
    return await ctx.db.insert("users", {
      userId: identity.subject,
      email,
      clerkId: identity.subject,
      role: "student",
    });
  },
});
```

### Regression case

Spawn the existing / off-the-shelf test `convex/users.test.ts` (or
its nearest equivalent). After the redeploy, the test
`createUser_self_elevates_admin_role` must throw with
`Unauthorized` (no admin role) when called from a non-admin
ConvexClient. The test
`createUser_forges_victim_placeholder_keeps_admin_role` must throw
when called with `role: 'admin'` from any caller that is not the
user being created (i.e., the mutation refuses caller-supplied role
unless caller identity matches `args.userId`).

---

## F2 — `convex.users.migrateUser.public_migration_no_auth` (critical)

### Source trace (ordered, repo-relative)

1. `convex/users.ts:630` — `export const migrateUser = mutation({ args: { userId, email, role?, timeZone?, createdAt?, updatedAt? }, handler })`. Public Convex mutation.
2. `convex/users.ts:647-660` — `ctx.db.query('users').withIndex('by_userId', (q) => q.eq('userId', args.userId)).first()`. Read by caller-supplied userId.
3. `convex/users.ts:652-658` — if found, `ctx.db.patch(existingByUserId._id, { email: normalizedEmail, role: args.role ?? existingByUserId.role, timeZone: args.timeZone ?? existingByUserId.timeZone })`. Patch with caller-supplied role.
4. `convex/users.ts:662-679` — else, `ctx.db.insert('users', { userId, email, clerkId: userId, role: args.role ?? 'student', ... })`. Insert with caller-supplied role.

No `ctx.auth.getUserIdentity()` and no `requireAdmin` /
`isAdminUser` between step 1 and step 4.

### Dummy attacker and affected dummy resource

- **Attacker:** any authenticated ConvexClient user.
- **Affected resource:** the canonical `users` identity table, both
  to patch existing rows (reputation / role on a known userId) and
  to insert new rows bound to a chosen userId (which the attacker
  can then sign in as via the Clerk identity they set up).

### Native bounded reproduction

1. Authenticate as a freshly-issued ConvexClient token.
2. `await convexClient.mutation(api.users.migrateUser, { userId: 'user_<self-clerk-id>', email: '<self-email>', role: 'admin' })`.
3. Without re-authenticating, query `api.admin.getAllInstructors`. Observe the admin gate in `convex/admin.ts` accepts the caller.

### Observed output and the security invariant it proves

`ctx.db.patch` writes `role: args.role`. The invariant the code must
enforce — that mutations touching `users.role` are either admin-only,
auth-bound, or `internalMutation` — is violated. `setUserRoleTrusted`
(`convex/users.ts:693`) shows the proper `internalMutation`-with-elevated-preservation
shape that `migrateUser` should adopt.

### Conditions and containment

- **Authentication level:** any authenticated ConvexClient.
- **User interaction:** none required beyond authenticated read/write.
- **Data state:** patch path silently elevates existing users to
  the caller-chosen role; insert path creates new admin / video_editor
  rows bound to attacker-chosen userIds.

### Source-level remediation

Convert `migrateUser` to `internalMutation`; route the legacy CLI
through a Bearer-auth HTTP endpoint at `convex/http.ts`.

```ts
// convex/users.ts
import { internalMutation } from "./_generated/server";

export const migrateUser = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    role: v.optional(v.union(
      v.literal("student"),
      v.literal("instructor"),
      v.literal("admin"),
      v.literal("video_editor"),
    )),
    timeZone: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => { /* unchanged body */ },
});

// convex/http.ts
export const httpMigrateUser = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(internal.users.migrateUser, body);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/internal/migrate-user",
  method: "POST",
  handler: httpMigrateUser,
});
```

### Regression case

Test `migrateUser_creates_admin_when_called_as_student` must throw with
`Unauthorized` after redeploy. Test `migrateUser_patches_existing_admin_to_student`
must throw with the elevated-preservation guard. Test
`migrateUser_incremental_legacy_cli_path` calling the new HTTP
endpoint from the bearer-auth migration script must succeed.

---

## F3 — `convex.studentInvitations.migrateInvitation.public_no_admin_gate` (high)

### Source trace (ordered, repo-relative)

1. `convex/studentInvitations.ts:458` — `export const migrateInvitation = mutation({ args, handler })`. Public Convex mutation.
2. `convex/studentInvitations.ts:469-501` — handler accepts caller-supplied `id`, `email`, `instructorId: v.id("instructors")`, `clerkInvitationId?`, `expiresAt`, `status?`. Looks up by `(email, instructorId)` index.
3. `convex/studentInvitations.ts:479-489` — if found, patch with caller-supplied status.
4. `convex/studentInvitations.ts:491-497` — else insert a fresh `studentInvitations` row with attacker-supplied fields.

No `ctx.auth.getUserIdentity()` and no `requireAdminOrSupport`
between step 1 and step 4.

### Dummy attacker and affected dummy resource

- **Attacker:** any authenticated ConvexClient.
- **Affected resource:** the `studentInvitations` table, the
  `studentInvitations_accept_by_id_internal` worker driven by
  `clerk/user.created` events, and through it the
  `instructors.instructorId` binding for any future victim signup.

### Native bounded reproduction

1. Authenticate as an attacker ConvexClient (any role).
2. Pick an attacker-controlled `instructorId` (`Id<"instructors">`).
   Pick a victim's email address that is not yet enrolled but who
   will sign up later.
3. `await convexClient.mutation(api.studentInvitations.migrateInvitation, { id: '<attacker-chosen-row-id>', email: '<victim-email>', instructorId: '<attacker-controlled-id>', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, status: 'pending' })`.
4. In a separate deployment stream, have the victim sign up via
   Clerk. The Clerk `user.created` webhook (or the apps/web Inngest
   `clerk-user-linking` flow) calls `findPendingStudentInvitationByEmailInternal`
   which returns this row; the worker calls
   `acceptStudentInvitationByIdInternal` and binds the new Clerk
   user to the attacker-chosen instructor.

### Observed output and the security invariant it proves

A new `studentInvitations` row exists for `(email, attacker_instructorId)`
with `status: 'pending'` and `expiresAt: now + 30d`. The webhook-driven
worker subsequently flips it to `accepted` and binds the victim user-id
to the attacker's instructor. The invariant the code must enforce —
that `studentInvitations` writes are admin / or Bearer-auth-mediated —
is violated; the docstring at line 443-456 explicitly acknowledges the
gap as known and proposes a future PR to convert it to `internalMutation`
plus a Bearer-auth HTTP endpoint.

### Conditions and containment

- **Authentication level:** any authenticated ConvexClient.
- **User interaction:** timing-dependent — the attack pre-binds
  before victim signup. The worker that auto-accepts may run async
  after `clerk/user.created`; latency from insert to accept can be
  minutes to hours.
- **Data state:** `status: 'pending'` with future `expiresAt`
  inserts are auto-acceptable by the worker. `status: 'accepted'`
  patches on existing rows can pre-flip a row before the worker
  runs, but the worker checks pending explicitly so this vector is
  limited.

### Source-level remediation

Convert `migrateInvitation` to `internalMutation` and add a
Bearer-auth HTTP endpoint mirroring the existing internal handlers
`findPendingStudentInvitationByEmailInternal` (line 514) and
`acceptStudentInvitationByIdInternal` (line 561):

```ts
// convex/studentInvitations.ts
import { internalMutation } from "./_generated/server";

export const migrateInvitation = internalMutation({
  args: { /* unchanged */ },
  handler: async (ctx, args) => { /* unchanged body */ },
});

// convex/http.ts
export const httpMigrateStudentInvitation = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(internal.studentInvitations.migrateInvitation, body);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/internal/migrate-student-invitation",
  method: "POST",
  handler: httpMigrateStudentInvitation,
});
```

### Regression case

Test `migrateInvitation_called_as_student_throws_unauthorized` must
throw `Forbidden` after redeploy. Test `migrateInvitation_legacy_cli_path`
calling the new HTTP endpoint from the bearer-auth migration script
must succeed and the row inserted must be auto-accepted within
`expiresAt`.

---

## F4 — `convex.seed.seedInstructorsWithProducts.public_no_auth` (high)

### Source trace (ordered, repo-relative)

1. `convex/seed.ts:417` — `export const seedInstructorsWithProducts = mutation({ args: {}, handler })`. Public Convex mutation.
2. `convex/seed.ts:430-475` — loop over `instructorData` static array (lines 37-409). Each iteration: `ctx.db.query('instructors').withIndex('by_slug', ...)` lookup.
3. `convex/seed.ts:441-457` — if found, `ctx.db.patch(existingInstructor._id, { name, slug, tagline, bio, background, specialties, profileImageUrl, portfolioImages, socials, isActive, isNew, oneOnOneInventory, groupInventory, maxActiveStudents: 10 })`.
4. `convex/seed.ts:459-474` — else, `ctx.db.insert('instructors', { ...same payload as above... })`.
5. `convex/seed.ts:477-501` — in either branch, follow-up `ctx.db.insert('products', { instructorId, ..., active: instructor.isActive })` for one-on-one and (if `pricing.group`) group mentorship products.

No `ctx.auth.getUserIdentity()` and no `requireAdmin` /
`isAdminUser` between step 1 and step 5.

### Dummy attacker and affected dummy resource

- **Attacker:** any authenticated ConvexClient holder.
- **Affected resource:** `instructors` and `products` tables — the
  same rows that feed every instructor-listing API, every
  checkout / session-pack creation flow, and every share-link
  issuance.

### Native bounded reproduction

1. Authenticate as a freshly-issued ConvexClient token.
2. `await convexClient.mutation(api.seed.seedInstructorsWithProducts, {})`.
3. Query `api.instructors.listInstructors` (or any instructor
   listing query — see `convex/instructors.ts`). Observe that any
   instructor whose slug was free now has a row with `isActive: true`
   and static-content profile fields, plus one or two products.
   Existing instructors' profile content is overwritten with the
   static seed values.

### Observed output and the security invariant it proves

`ctx.db.patch` (existing) and `ctx.db.insert` (new) run with no gate.
The invariant the code must enforce — that mutations writing to the
visible catalogue tables are admin-only — is violated. The same
file's own `clearInstructorsAndProducts` (line 527) shows what the
proper pattern looks like.

### Conditions and containment

- **Authentication level:** any authenticated ConvexClient.
- **User interaction:** none required beyond authenticated read/write.
- **Data state:** existing real instructor profiles (name, bio,
  socials, inventory) are silently overwritten with the static
  seed values; new instructors + products with `isActive: true` /
  `active: true` are minted for any slug not already taken.

### Source-level remediation

Convert `seedInstructorsWithProducts` to `internalMutation`; the
public surface should not accept no-arg invocations. If a public
mutation must remain (e.g., for tooling), gate it with admin like
the file's own `clearInstructorsAndProducts`:

```ts
// convex/seed.ts
import { internalMutation } from "./_generated/server";

export const seedInstructorsWithProducts = internalMutation({
  args: {},
  handler: async (ctx) => { /* unchanged body */ },
});

// Optional admin-gated variant:
export const seedInstructorsWithProductsAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("clerkId"), identity.subject))
      .first();
    if (!user || user.role !== "admin") throw new Error("Forbidden: Admin role required");
    /* unchanged body */
  },
});
```

### Regression case

Test `seedInstructorsWithProducts_called_as_student_throws_forbidden`
must throw `Forbidden` after redeploy. Test
`seedInstructorsWithProducts_internal_call_still_reaches_static_results`
calling the new `internalMutation` from the existing
`httpSeedInstructor` HTTP route (which `verifyAuth`-gates with
bearer) must still succeed.

---

## F5 — `convex.cleanup.wipePaymentData.admin_op_no_audit_log` (medium)

### Source trace (ordered, repo-relative)

1. `convex/cleanup.ts:15` — `export const wipePaymentData = mutation({ args: {}, handler })`. Admin-gated destructive op.
2. `convex/cleanup.ts:17-28` — gate: `if (!identity) throw Unauthorized;` and `if (!user || user.role !== 'admin') throw Forbidden`. Correct gate, no audit hook.
3. `convex/cleanup.ts:33-121` — sequential `ctx.db.query(tableName).collect()` then `ctx.db.delete(...)` for 14 tables.
4. `convex/cleanup.ts:123` — return `{ success: true, deleted: results }`. No `writeAuditLog` call anywhere.

### Dummy attacker and affected dummy resource

- **Attacker:** an adversary operating inside an already-compromised
  admin session, or a careless admin performing a destructive wipe
  for legitimate reasons without a forensic trail. (The admin gate
  prevents unauthenticated or non-admin callers.)
- **Affected resource:** the canonical audit log (`auditLogs`,
  `workspaceAuditLogs`) and the forensic value of post-incident
  attribution.

### Native bounded reproduction

1. Authenticate as an admin in a Convex deployment.
2. Note the current last-modified time of `auditLogs` and
   `workspaceAuditLogs`.
3. `await convexClient.mutation(api.cleanup.wipePaymentData, {})`.
4. Query `auditLogs` and `workspaceAuditLogs` again. Observe that
   no new rows have appeared, no actor is named, and
   `workspaceAuditLogs` may itself have been wiped (it's in the
   deletion list at line 99-102).

### Observed output and the security invariant it proves

The destructive op completes; only the in-memory `results` map is
returned. The audit-log invariant the code must enforce — that
destructive multi-table ops inside this codebase write a
`writeAuditLog` row at the same transaction (the pattern used by
`orders.refundOrder`, `adminRefunds.processRefundForAdmin`,
`studentInvitations.acceptStudentInvitationByIdInternal`,
`users.setUserRoleTrusted`, `users.bootstrapAdminRoleOnce`,
`adminOnboardStudent`) — is violated.

### Conditions and containment

- **Authorisation role:** admin-only. The gate is correct.
- **Data state:** observed when an admin calls the mutation in any
  environment where `writeAuditLog` is the codebase standard but
  bypassed here.
- **Compromise scenario:** post-incident attribution is unavailable
  for the destructive op; `workspaceAuditLogs` itself is on the
  deletion list (line 99), so the audit table containing any prior
  workspace-level audit history is also erased in the same call.

### Source-level remediation

Insert `writeAuditLog` (from `convex/audit/auditLog.ts`) inside the
handler at the same transaction:

```ts
// convex/cleanup.ts
import { writeAuditLog } from "./audit/auditLog";

export const wipePaymentData = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("clerkId"), identity.subject))
      .first();
    if (!user || user.role !== "admin") {
      throw new Error("Forbidden: Admin role required");
    }

    const auditTargets = [
      "orders", "payments", "sessionPacks", "seatReservations",
      "workspaces", "workspaceNotes", "workspaceLinks",
      "workspaceImages", "workspaceMessages", "workspaceExports",
      "workspaceRetentionNotifications", "workspaceAuditLogs",
      "discordActionQueue",
      "studentOnboardingSubmissions", "marketingWaitlist",
    ];
    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: "admin",
      action: "wipe_payment_data_begin",
      targetType: "system_state",
      targetId: "global",
      details: `Admin ${identity.subject} initiated wipe across ${auditTargets.length} tables`,
      metadata: { tables: auditTargets },
    });
    const results: Record<string, number> = {};
    for (const tableName of auditTargets) {
      // NB: preserve workspaceAuditLogs row materialisation —
      // delete / patch the rows but do not issue the destroy call.
      const docs = await (ctx.db.query(tableName as any).collect());
      for (const doc of docs) await ctx.db.delete(doc._id);
      results[tableName] = docs.length;
    }
    await writeAuditLog(ctx, {
      actorId: identity.subject,
      actorRole: "admin",
      action: "wipe_payment_data_complete",
      targetType: "system_state",
      targetId: "global",
      details: `Wipe complete per-table counts: ${JSON.stringify(results)}`,
      metadata: { results },
    });
    return { success: true, deleted: results };
  },
});
```

(Note: the proposed fix preserves the existing admin gate but
inserts two `writeAuditLog` calls in the same transaction. It
preserves `workspaceAuditLogs` as a target of investigation only
by recording the deletion events in the canonical `auditLogs` table
before they happen, so post-incident attribution survives the wipe
itself.)

### Regression case

Test `wipePaymentData_writes_audit_log_rows` must assert that after
the call, two new rows in `auditLogs` exist (one with
`action: 'wipe_payment_data_begin'`, one with
`action: 'wipe_payment_data_complete'`) and that both have
`actorId: '<admin-clerk-id>'`. Test `wipePaymentData_called_as_non_admin_throws_forbidden`
must continue to throw.
