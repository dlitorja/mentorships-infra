# LLM judgment of scan candidates

## convex/adminOnboarding.ts

- :625 retryAdminOnboarding — admin-gated via `isAdminOrSupport`. **FALSE POSITIVE.**
- :715 resendAdminOnboardingInvitation — admin-gated via `isAdminOrSupport`. **FALSE POSITIVE.**
- :789 cancelAdminOnboarding — admin-gated via `isAdminOrSupport`. **FALSE POSITIVE.**
- :1823 getOnboardingView — public query, admin-gated via `canViewOnboarding` (which checks caller role). **NEED TO VERIFY** but likely FALSE POSITIVE.
- :2191 setStudentTimezone — function limited to assigned student; need to verify.

## convex/adminWorkspaces.ts

- :158 getWorkspaceByIdAdmin — admin-gated via `isAdmin`. **FALSE POSITIVE.**
- :264 createAdminInstructorWorkspace — admin-gated, but is shape (d) because args.instructorId used in insert. **FALSE POSITIVE** (admin only mutates admin data).
- :398-630 (deleteWorkspaceAdmin, updateWorkspaceAdmin, updateWorkspaceOwner, updateWorkspaceInstructor, clearWorkspaceInstructor, linkWorkspaceToSessionPack) — admin-gated via `isAdmin`. **FALSE POSITIVE.**

## convex/instructorResources.ts
- :127 getInstructorResources — public query, but only loads by `args.workspaceId`. **VERIFY**: does it check that caller is a participant?
- :206 uploadInstructorResource — public mutation. **VERIFY**: does it check the workspace?
- :348 shareResourceToChat — public mutation. same parent-FK shape (d) suspicion.

## convex/instructors.ts
Many of these are no-auth or admin-only. Let me check each.

## convex/payments.ts
**HIGH BLOCK**: payments are critical. Many have NO auth. Migrations are explicitly named but createPayment/completePayment/updatePayment etc. should add `requireIdentity` + ownership check.

Actions to apply (canonical):
- `createPayment`, `updatePayment`, `completePayment`, `refundPayment`, `failPayment`, `deletePayment`: add `requireIdentity` + arg.id ownership check. But these are reached by HTTP webhook routes AND admin routes; the canonical fix is making them internalMutation or requiring `requireAdmin` plus caller checks.
- `adminProcessRefund`: has `ctx.auth` but no admin role check. CRITICAL: harden with `requireAdminUser` + use adminProcessRefundInternal.
- `migratePayment`: explicitly a migration. Convert to internalMutation.

## convex/products.ts
- createProduct, updateProduct, deleteProduct, deactivateProduct, activateProduct — admin-gated in this codebase? Need to verify.
- migrateProduct — migration, convert to internalMutation.

## convex/orders.ts
All 6 order functions have NO auth (createOrder, updateOrder, completeOrder, cancelOrder, refundOrder, deleteOrder, migrateOrder). migrateOrder is migration. The rest are CRITICAL (financial).

## convex/seatReservations.ts
- createSeatReservation, updateSeatReservation, releaseSeat, extendSeat: written by signup flow — typically admin/staff gated.
- migrateSeatReservation: migration.
- deleteSeatReservation, processExpiredSeats: cleanup; convert to internal.

## convex/sessionPacks.ts
- createSessionPack, updateSessionPack: coupon admin / payment webhook flow. 
- useSession: session usage — should check student ownership.
- refundSessionPack: should be admin.
- expireSessionPack, processExpiredSessionPacks: cron.
- migrateSessionPack, deleteSessionPack: migrations/admin cleanup.

## convex/studentOnboarding.ts
- :133 create — already does `args.userId !== identity.subject` check after `requireIdentity`. FALSE POSITIVE scanner flagged due to scan-window heuristic.
- :230 markReviewed — shapes: needs `requireIdentity` + check instructor role.

## convex/studentOnboarding.ts and studentInvitations.ts
- createStudentInvitation: shape (d) flagged (args.instructorId). 

## convex/studentSessionCounts.ts
- upsertSessionCount: shape (d) — args.instructorId used in patch. Verify ownership check.
- adjustSessionCount, updateSessionCount, deleteSessionCount, migrateSessionCount.

## convex/users.ts
- createUser, migrateUser, getUserByClerkIdPublic.

## convex/videoEditorAssignments.ts
- createVideoEditorAssignment, setVideoEditorAssignmentQuota, setVideoEditorAssignmentQuotaByIds.

## convex/workspaces.ts
- archiveWorkspace, unarchiveWorkspace.

## Other files
- contacts.ts addContact: no-auth mutation. Quietly creates contact records. **Lower risk**.
- discordActionQueue.ts migrateDiscordAction: migration.
- userIdentities.ts migrateUserIdentity: migration. upsertUserIdentity: no-auth.
