# Needs validation — unvalidated or unresolved records

This run produced no `needs_validation` records: every candidate
either became a `confirmed` record after the parent-direct re-read
or was excluded as hardening. The five candidate fingerprints live
in `findings.json` under a verdict of `confirmed`.

If a future re-run promotes a record out of `confirmed` (e.g. a
fresh, independent reviewer reverses the verdict), the affected
record will be lifted into this file with a per-record section
covering: source trace, exact blocker, full local validation plan,
and a safe owner-observed deployment check.

## Re-validation plan for the existing confirmed records

Even though the five confirmed records in this run were the product
of a parent-direct re-read, the harness constraint that prevents a
fresh independent reviewer means that any operator-side weak signal
in the source should be confirmed end-to-end before remediation
lands. For each confirmed record, the following two-step plan
meets the skill's "independent reviewer" intent:

### F1 — `convex.users.createUser.public_mutation_no_auth`

- **Local:** Deploy a throwaway Convex backend pointed at this
  source ref. Connect a dummy principal ConvexClient token via
  `npx convex login --deployment <preview>`. From outside the parent
  environment, call
  `convexClient.mutation(api.users.createUser, { userId: 'user_<self-clerk-id>', email: '<self-email>', clerkId: 'user_<self-clerk-id>', role: 'admin' })`.
  Observe a fresh `users` row with `role: 'admin'`. Then call
  `api.admin.getAllInstructors` and observe success.
- **Deployment:** Owners of any production deployment of this repo
  should grep `convex.deploymentHistory` and Convex's
  `users`-audit table (if present) for any rows written by
  `api.users.createUser` outside the documented bearer-auth caller
  set; if any are present, treat the production data as suspect and
  re-seed canonical identity rows. Ensure `setUserRoleTrusted` is
  the only path for `users.role` writes (`users.role === 'admin'`
  invocations audit must show `actorRole: 'system'` from
  `seed-role` or `bootstrapAdminRoleOnce`, not a row written by
  `createUser`).

### F2 — `convex.users.migrateUser.public_migration_no_auth`

- **Local:** Same as F1 but with
  `api.users.migrateUser({ userId: ..., email: ..., role: 'admin' })`.
  Both patch path (existing userId) and insert path (new userId)
  can be reproduced against a throwaway deployment.
- **Deployment:** Audit any production users row whose `role` was
  set without a corresponding `set_user_role` audit row pointing
  at `actorRole: 'admin'/'system'/'ops-script'`; treat those as
  suspect. Note that `migrationQueries` and the legacy migration
  tools may have left such rows historically; correlate with the
  `auditLog` table.

### F3 — `convex.studentInvitations.migrateInvitation.public_no_admin_gate`

- **Local:** Against a throwaway deployment, call
  `api.studentInvitations.migrateInvitation({ ... status: 'pending', expiresAt: future, email: '<victim-email>', instructorId: '<attacker-instructor>' })`.
  Observe the resulting row in `studentInvitations`. Then simulate
  the `clerk/user.created` flow and observe the worker calls
  `acceptStudentInvitationByIdInternal` against this row.
- **Deployment:** In production, query `studentInvitations` for any
  row whose `status: 'pending'` has `expiresAt: <now+24h>` and was
  created by an actor whose `clerkId` does not appear in the
  `auditLog` actor set; correlate those rows against legitimate
  outbound invitation emails.

### F4 — `convex.seed.seedInstructorsWithProducts.public_no_auth`

- **Local:** Against a throwaway deployment, call
  `api.seed.seedInstructorsWithProducts({})` from a non-admin
  ConvexClient. Observe every `instructors` and `products` row is
  overwritten or inserted.
- **Deployment:** Audit instructor + product table last-modified
  timestamps; if any cluster of changes lands at a moment with no
  corresponding `system`-actor audit row (the only legitimate
  caller is the `httpSeedInstructor` HTTP route which is
  `verifyAuth`-bearer-gated), treat the change-set as suspect.

### F5 — `convex.cleanup.wipePaymentData.admin_op_no_audit_log`

- **Local:** Against a throwaway deployment with a fresh seed,
  authenticate as admin and call `api.cleanup.wipePaymentData({})`.
  Query `auditLogs` afterwards; observe zero new rows including
  zero `wipe_payment_data_begin` / `wipe_payment_data_complete`.
- **Deployment:** Production deployments of this repo do not yet
  retain server-side `auditLogs` rows for `wipePaymentData`,
  because the handler does not write one. The audit gap is
  structural; remediation is the `writeAuditLog`-inserted-into-the-same-transaction
  pattern applied in the source-level fix above. Owners should
  retroactively attribute any past `wipePaymentData` invocation from
  external request logs (Convex dashboards / Vercel logs) before
  applying the fix.

## Files / lines confirmed during the re-read

- `convex/users.ts` lines 1-1100, with a focus on 228-262, 446-628, 630-682, 685-940.
- `convex/studentInvitations.ts` lines 1-607.
- `convex/seed.ts` lines 1-595.
- `convex/cleanup.ts` lines 1-125.
- `convex/http.ts` lines 1-2334.
- `convex/audit/auditLog.ts` for the comparator `writeAuditLog`.
- `convex/workspaces.ts` lines 380-440 for the strict participant gate.
- `convex/instructorUploads.ts` lines 1-1492 (read in full; no candidate raised).
- `convex/hdShareLinks.ts` lines 1-286 (two-phase auth pattern noted as hardening).
- `convex/auth.config.ts` for Clerk JWT issuer domain configuration.

No re-validation found a false premise in any of the five confirmed
records under source review.
