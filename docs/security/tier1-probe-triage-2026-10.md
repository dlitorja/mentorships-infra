# Tier 1 probe triage — 2026-10 baseline

**Purpose:** establish the Phase A false-positive rate for the Tier 1
convex-probe before any Phase B blocking decision (protocol §9).
**Triage date:** 2026-10-25
**Source tree:** `fix/convex-close-remaining-public-mutations@a8b27916`
(includes #957, #958 and #959)
**Detectors:** `.scripts/convex-probe/scan-b.ts` (shapes a–d),
`.scripts/convex-probe/scan-d.ts` (no-auth writable mutations)
**Hits reviewed:** 99 (37 scan-b, 62 scan-d) — every hit, not a sample.

---

## 1. Headline numbers

| Detector | Hits | True positive | False positive | FP rate |
| --- | ---: | ---: | ---: | ---: |
| `scan-b` (shapes b/d) | 37 | 3 | 34 | **91.9%** |
| `scan-d` (no-auth writable) | 62 | 50 | 12 | **19.4%** |
| Combined | 99 | 53 | 46 | **46.5%** |

After collapsing duplicate findings (scan-b reports one hit per
`ctx.db.get(args.X)` occurrence, so `studentSessionCounts` appears twice for
three functions): **96 unique functions — 53 TP, 43 FP (55.2% TP)**.

Baseline drift since the probe merged:

| Point in time | scan-b | scan-d |
| --- | ---: | ---: |
| #956 (probe PR) | 37 | 79 |
| `main@6cf769bd` (after #957 + #958) | 37 | 64 |
| #959 | 37 | 62 |
| #962 (+ scan-b wave) | 36 | 62 |
| HUC-121 (detector hardening, 2026-11-02) | 24 | 48 visible (50 detected) |
| HUC-116 wave 1a (dead money writers internalized, 2026-11-02) | 24 | 39 visible (41 detected) |

The F-series removed 17 public writers from scan-d without changing a single
scan-b hit — none of the converted functions were shape-b/d candidates.

HUC-121 recovered 12 scan-d false positives (5 service-key guards, 6 upload
delete guards, 1 `caller.role` check) → 50 detected, all TP. Two accepted public
surfaces (`contacts.addContact`, `orders.updateOrder`) are now recorded in
`suppressions.json`, so the *visible* surface is 48. On scan-b, 10 unique
findings were recovered, 1 new shape-d candidate surfaced, and 3 duplicate rows
collapsed (36 reported / 33 unique → 24 reported / 24 unique). The new
candidate is `instructorUploads.createUpload`
because `caller.role` is now recognised as auth; it is a known FP — the
function validates the target instructor by the `by_userId` index — and is
recorded in the baseline rather than suppressed.

---

## 2. What this means for Phase B

**Do not flip either detector to blocking as-is.**

- `scan-b` is structurally noisy: shape (b) fires on any public function that
  has *some* auth but no literal `identity.subject === row.owner` comparison.
  Every admin-gated mutation in the codebase is therefore a hit, because
  "admin may act on any row" is correct and needs no per-row owner check. 34 of
  37 hits are this pattern. Fixing it is not a detector patch — it requires a
  different ownership model (e.g. "admin gate OR owner gate" as an accepted
  shape).
- `scan-d` is close to usable. All 12 false positives come from five
  recognisable guard idioms the scanner does not know about. Fix those and the
  detector emits 50 hits, all true positives.

Recommended sequence:

1. ~~**Detector hardening PR** (§4)~~ — **done (HUC-121)**: scan-d 62 → 50
   detected (48 visible after suppressions), all TP; scan-b 36 → 24.
2. **Remediation waves** (§5) for the 50 real no-auth writers (HUC-116 –
   HUC-120).
3. **Phase B, new-hits-only:** the post-hardening baseline is committed as
   `tier1.diff.json`; `diff.ts --fail-on-new` is the switch. Do not block on
   the existing backlog — it would fail every PR until the waves land. Not
   enabled yet; requires the per-tier owner's sign-off.
4. Keep `scan-b` advisory permanently unless the ownership heuristic is
   redesigned. Its signal is real (3 TPs) but the ratio makes it unusable as a
   gate.

---

## 3. scan-b / scan-d hit-by-hit verdicts

### 3.1 scan-b shapes b/d — 37 hits, 3 TP

| # | Function | Shape | Verdict | Evidence |
| ---: | --- | --- | --- | --- |
| 1 | `adminOnboarding.retryAdminOnboarding` | b | FP | `isAdminOrSupport(ctx, identity.subject)` — admin acts on any onboarding row |
| 2 | `adminOnboarding.resendAdminOnboardingInvitation` | b | FP | same gate |
| 3 | `adminOnboarding.cancelAdminOnboarding` | b | FP | same gate |
| 4 | `adminWorkspaces.getWorkspaceByIdAdmin` | b | FP | `isAdmin(ctx, user.subject)` |
| 5 | `adminWorkspaces.createAdminInstructorWorkspace` | d | FP | `isAdmin` before insert; instructor FK validated by admin tooling |
| 6 | `adminWorkspaces.deleteWorkspaceAdmin` | b | FP | `isAdmin` |
| 7 | `adminWorkspaces.updateWorkspaceAdmin` | b | FP | `isAdmin` |
| 8 | `adminWorkspaces.updateWorkspaceOwner` | b | FP | `isAdmin` |
| 9 | `adminWorkspaces.updateWorkspaceInstructor` | b | FP | `isAdmin` |
| 10 | `adminWorkspaces.clearWorkspaceInstructor` | b | FP | `isAdmin` |
| 11 | `instructorResources.getInstructorResources` | b | FP | checks `workspace.instructorId !== instructor._id`, where `instructor` is resolved from `identity.subject` |
| 12 | **`instructors.getInstructorById`** | b | **TP** | any authenticated user receives `{ ...instructor }`, including `googleRefreshToken`, `discordVoiceChannelUrl`, inventory and scheduling fields. `getInstructorBySlug` already allow-lists public fields for the same document — this query does not |
| 13 | `instructors.updateStudentResultStorageId` | b | FP | admin gate (`user?.role !== "admin"`) |
| 14 | `instructors.getTestimonialById` | b | FP | any-auth read of public marketing content |
| 15 | `instructors.getStudentResultById` | b | FP | any-auth read of public marketing content |
| 16 | `instructors.getStudentDetails` | b | FP | `instructor.userId !== user.subject` (`.subject` on the right-hand side; scanner only matches it on the left) |
| 17 | `instructors.deleteTestimonial` | b | FP | role gate + instructor-ownership check |
| 18 | `instructors.deleteStudentResult` | b | FP | role gate + instructor-ownership check |
| 19 | **`payments.adminProcessRefund`** | b | **TP** | checks identity but **not role**. The sibling `adminProcessRefundInternal` docstring states this explicitly ("The public mutation checks identity but not role"). Any signed-in user can refund any payment |
| 20 | **`products.getProductForAdmin`** | b | **TP** | identity only, no admin role; any signed-in user reads any product, including soft-deleted/inactive |
| 21 | `seatReservations.getInstructorActiveSeats` | b | FP | `instructor.userId !== user.subject` (right-hand side) |
| 22 | `seatReservations.getInstructorStudentsWithRemainingSessions` | b | FP | same |
| 23 | `studentInvitations.createStudentInvitation` | d | FP | `requireAdminOrSupport` |
| 24 | `studentOnboarding.create` | d | FP | `args.userId !== identity.subject` |
| 25 | `studentSessionCounts.upsertSessionCount` | d | FP | `isAdminUser` |
| 26 | `studentSessionCounts.upsertSessionCount` | d | FP | duplicate of #25 (insert branch) |
| 27 | `studentSessionCounts.updateSessionCount` | b | FP | `isAdminUser` |
| 28 | `studentSessionCounts.updateSessionCount` | b | FP | duplicate of #27 |
| 29 | `studentSessionCounts.adjustSessionCount` | b | FP | `isAdminUser` |
| 30 | `studentSessionCounts.adjustSessionCount` | b | FP | duplicate of #29 |
| 31 | `studentSessionCounts.deleteSessionCount` | b | FP | `isAdminUser` |
| 32 | `users.getUserByClerkIdPublic` | b | FP | role gate + session-instructor match + `session.studentId === args.userId` |
| 33 | `videoEditorAssignments.setVideoEditorAssignmentQuota` | b | FP | admin gate |
| 34 | `videoEditorAssignments.setVideoEditorAssignmentQuotaByIds` | d | FP | admin gate |
| 35 | `videoEditorAssignments.createVideoEditorAssignment` | d | FP | admin gate |
| 36 | `workspaces.archiveWorkspace` | b | FP | `assertCanToggleArchive(ctx, workspace, identity.subject)` |
| 37 | `workspaces.unarchiveWorkspace` | b | FP | same |

### 3.2 scan-d no-auth writable mutations — 62 hits, 50 TP

**True positives**

| Function | Notes |
| --- | --- |
| `adminWorkspaces.linkWorkspaceToSessionPack` | only guard is `confirmSeed: true`, which any caller can send |
| `contacts.addContact` | accepted public marketing form; abuse/rate-limit risk only |
| `instructors.createInstructor` | anyone can create instructor profiles |
| `instructors.decrementInventory` / `incrementInventory` | anyone can move inventory |
| `instructors.upsertInstructorTestimonial` / `upsertStudentResult` | anyone can write marketing content |
| `instructors.uploadInstructorProfileImage` / `uploadInstructorPortfolioImage` / `uploadStudentResultImage` | anyone can overwrite images on any instructor |
| `instructors.updateInstructorProfileImage` / `updateInstructorPortfolioImage` | same |
| `instructorUploads.updateUploadStarted` / `completeUpload` | anyone can flip upload state and transfer status |
| `mutations/http.createRetentionNotification` / `updateWorkspaceExportStatus` | bearer-only callers, but the public mutation is directly callable |
| `orders.createOrder` | anyone can create arbitrary orders |
| `orders.updateOrder` | documented narrow surface (`status: "failed"` only, terminal-state guard) — accepted, but still a public write |
| `payments.createPayment` / `updatePayment` / `completePayment` / `refundPayment` / `failPayment` / `deletePayment` | anyone can mark a payment completed/refunded or soft-delete it |
| `products.createProduct` / `updateProduct` / `deleteProduct` / `deactivateProduct` / `activateProduct` | anyone can rewrite the catalogue |
| `seatReservations.createSeatReservation` / `updateSeatReservation` / `releaseSeat` / `extendSeat` / `deleteSeatReservation` / `processExpiredSeats` | anyone can create/release/extend/delete seats and end workspaces |
| `sessionPacks.createSessionPack` / `updateSessionPack` / `useSession` / `refundSessionPack` / `expireSessionPack` / `processExpiredSessionPacks` / `deleteSessionPack` | anyone can create/consume/refund/delete packs |
| `sessions.updateSession` / `completeSession` / `deleteSession` | anyone can reschedule/complete/delete sessions |
| `studentOnboarding.markReviewed` | `args.instructorId` and `args.reviewedByUserId` are both caller-supplied |
| `userIdentities.upsertUserIdentity` | anyone can bind a Discord id to any user |
| `workspaces.logViewWorkspaceAudit` / `createRetentionNotification` / `acknowledgeNotification` | forged audit rows and notification state |

**False positives — 12 hits, all from five guard idioms**

| Function | Missed guard |
| --- | --- |
| `instructorUploads.createUpload` | role check reads a `caller` variable, not `ctx.auth` |
| `instructorUploads.markUploadForCleanup` / `softDeleteUpload` / `deleteUpload` / `restoreUpload` | `requireDeleteAccess(ctx, upload)` |
| `instructorUploads.hardDeleteUpload` | `requireAdminDeleteAccess(ctx)` |
| `onboardingWorkExamples.deleteWorkExample` | `requireAssignedStudentForUpload(ctx, …)` |
| `orders.completeOrder` / `cancelOrder` / `refundOrder` / `deleteOrder` / `migrateOrder` | `assertServiceKey(args.serviceKey)` |

---

## 4. Detector gaps (hardening PR — delivered in HUC-121)

| # | Gap | Fix | Hits recovered |
| ---: | --- | --- | ---: |
| 1 | Service-key gate not recognised | add `assertServiceKey\s*\(` and `serviceKey\s*:\s*v\.string\(\)` to `hasAuthCheck` | 5 |
| 2 | Local delete helpers | add `requireDeleteAccess`, `requireAdminDeleteAccess`, `requireAssignedStudentForUpload` to the helper whitelist | 6 |
| 3 | Role check via a resolved `caller` object | treat `\bcaller\b` + `\.role\s*(===|!==)` as auth | 1 |
| 4 | `.subject` comparison on the **right** side (`row.userId !== user.subject`) | extend `hasIdentityComparison` to `(===|!==)\s*\w+\.subject` | 3 |
| 5 | Ownership check via an indirection (`workspace.instructorId !== instructor._id`) | treat a comparison between a loaded row's FK and a variable named `instructor`/`owner` as an ownership check | 1 (scan-b) |
| 6 | Duplicate hits per `ctx.db.get` occurrence | dedupe findings per `(file, function)` | 3 scan-b rows |

Delivered (HUC-121):

- All six gaps above are implemented in `.scripts/convex-probe/lib.ts` and
  covered by `detector.test.ts` (18 tests).
- An additional gap found after #962: `hasIdentityComparison` did not recognise
  the `isAdminUser` / `requireAdminActor` helper gates, so fixed admin
  mutations (e.g. `products.getProductForAdmin`) stayed flagged. Both helpers
  are now recognised, matching the "admin gate OR owner gate" model this
  document argues for.
- `suppressions.json` exists with `{file, function, scanner, reason, owner,
  expires}`; expired entries stop suppressing automatically so the finding
  resurfaces.
- `tier1.diff.json` is the committed post-hardening baseline. `diff.ts`
  reports `new`/`fixed` per scanner and writes `artifacts/tier1.diff.json`;
  `--fail-on-new` is the Phase B switch (not enabled).

Actual post-fix output: **scan-d 50 detected (all TP, 0% FP), 48 visible after
the two accepted suppressions**; scan-b **24** (17 shape b, 7 shape d), still
dominated by admin-by-design and public-read FPs. That is 10 unique findings
fewer than the triage's 34 estimate because the admin-helper recognition
removes the admin-by-design class the estimate assumed would stay.

---

## 5. Remediation backlog (from the TPs)

**Wave 1a delivered (HUC-116):** the nine dead money writers — `payments.updatePayment` /
`completePayment` / `failPayment` / `deletePayment` and
`sessionPacks.updateSessionPack` / `useSession` / `expireSessionPack` /
`processExpiredSessionPacks` / `deleteSessionPack` — are now `internalMutation`.
They had no live callers (only unused client hooks, removed in the same PR), so
the public surface closes with no caller migration. Pinned by
`convex/moneySurface.test.ts`. scan-d: 48 → 39 visible (41 detected).

Wave 1b remains: the five server-only creators/refunders
(`payments.createPayment`, `payments.refundPayment`,
`sessionPacks.createSessionPack`, `sessionPacks.refundSessionPack`) and
`orders.createOrder` need the bearer-endpoint migration of their Inngest /
checkout callers (endpoints already exist for four of them; `/orders/create` is
new).

Grouped for sequencing. Severity is the writer's blast radius, not the
detector's.

| Wave | Theme | Functions | Why first |
| --- | --- | --- | --- |
| 1 | Money | `payments.*` (6), `orders.createOrder`, `sessionPacks.*` (7) | direct financial state; `adminProcessRefund` role bypass is the single highest-severity TP |
| 2 | Instructor profile integrity | `instructors.createInstructor`, image uploads (5), testimonial/result upserts (2), inventory (2), `instructors.getInstructorById` (read) | defacement and credential exposure (`googleRefreshToken`) |
| 3 | Entitlements | `seatReservations.*` (6), `sessions.*` (3), `studentOnboarding.markReviewed` | access control / scheduling |
| 4 | Catalogue & identity | `products.*` (5), `userIdentities.upsertUserIdentity`, `adminWorkspaces.linkWorkspaceToSessionPack` | lower blast radius, but same pattern |
| 5 | Housekeeping | `mutations/http.*` (2), `workspaces.*` (3), `instructorUploads.updateUploadStarted` / `completeUpload`, `contacts.addContact` (accept) | forged audit/notification state, upload state |

The fix shape is the one established by #957–#959: `internalMutation` plus a
bearer-gated HTTP endpoint for server callers, or an identity-scoped public
mutation when a real user action is involved. `orders.migrateOrder` is already
`assertServiceKey`-gated and needs nothing.

---

## 6. Follow-ups

1. Open the detector-hardening issue (§4) and land it before Phase B.
2. Open one issue per remediation wave (§5), each with the exact function list
   and the #957–#959 transport pattern.
3. Record this baseline in the protocol (§9) as the Phase A exit artifact.
4. Re-run the probe after each wave and update the drift table in §1.
