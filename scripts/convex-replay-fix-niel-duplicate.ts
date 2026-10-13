/**
 * Runbook: reassign Neil Gray's data from a duplicate `instructors`
 * account to the canonical one.
 *
 * Background:
 *   Accepting a Clerk invitation for `nrcgray@gmail.com` on 2026-09-27
 *   created a second `instructors` row + a second `users` row because
 *   `convex/hdInvitations.ts:markInvitationAccepted` only checked
 *   `users.by_clerkId`. The new (duplicate) instructor was assigned
 *   to Tracy Houston's workspace/sessionPack/seatReservation/session, so Neil
 *   could no longer see Tracy in `/workspace`.
 *
 * What this runbook does:
 *   Runs the deployed internal mutation
 *   `internal.adminMigration.reassignInstructorFromDuplicate` once.
 *   The mutation is idempotent and safe to re-run.
 *
 * After PR merge + auto-deploy:
 *
 *   1. Verify the mutation is reachable (should print the plan only):
 *
 *        npx convex run --deployment fine-bulldog-260 \
 *          adminMigration.js:reassignInstructorFromDuplicate \
 *          '{"oldInstructorId":"jd748t2bzr76fh8wazzxwsv6tn8f8hhj","oldUserId":"j575hh3gp04w8asagws33gb0ks8f8apv","oldClerkUserId":"user_3Jw6nFD2FxAA4631ZFRP7wkODsG","newInstructorId":"jd79ys4j7ga0xn4x5292v383g9857ra1","dryRun":true}'
 *
 *      Expected output (truncated):
 *
 *        {
 *          "plan": {
 *            "oldInstructor": { "_id": "jd748t2bzr76fh8wazzxwsv6tn8f8hhj", "email": "nrcgray@gmail.com", ... },
 *            "newInstructor": { "_id": "jd79ys4j7ga0xn4x5292v383g9857ra1", "name": "Neil Gray", ... },
 *            "oldUser": { "_id": "j575hh3gp04w8asagws33gb0ks8f8apv", ... },
 *            "counts": { "workspaces": 1, "sessionPacks": 1, "seatReservations": 1, "sessions": 0 }
 *          },
 *          "applied": false
 *        }
 *
 *   2. Run for real (re-applies; safe to re-run):
 *
 *        npx convex run --deployment fine-bulldog-260 \
 *          adminMigration.js:reassignInstructorFromDuplicate \
 *          '{"oldInstructorId":"jd748t2bzr76fh8wazzxwsv6tn8f8hhj","oldUserId":"j575hh3gp04w8asagws33gb0ks8f8apv","oldClerkUserId":"user_3Jw6nFD2FxAA4631ZFRP7wkODsG","newInstructorId":"jd79ys4j7ga0xn4x5292v383g9857ra1"}'
 *
 *   3. Verify (read-only):
 *
 *        # Workspace now points at the real Neil.
 *        npx convex run --deployment fine-bulldog-260 \
 *          workspaces.js:getWorkspace \
 *          '{"id":"m971zc933x3yrx4ddzj354gp098fzd0a"}'
 *
 *        # Duplicate instructor is soft-deleted.
 *        npx convex data --deployment fine-bulldog-260 instructors \
 *          --format jsonl | jq 'select(._id == "jd748t2bzr76fh8wazzxwsv6tn8f8hhj")'
 *
 *        # pendingClerkDeletions has a row for the duplicate Clerk user
 *        # (the 5-min `processPendingClerkDeletions` cron will pick it up).
 *        npx convex data --deployment fine-bulldog-260 pendingClerkDeletions \
 *          --format jsonl | jq 'select(.clerkUserId == "user_3Jw6nFD2FxAA4631ZFRP7wkODsG")'
 *
 *   4. Confirm Neil can now see Tracy in `/workspace`:
 *        - Sign in as Neil (nrcgray@gmail.com, Clerk user
 *          `user_3JLY363VPXgJK8p4GhCWjuM4b10`)
 *        - Navigate to `/workspace`
 *        - Workspace `tracyhouston000@gmail.com × nrcgray@gmail.com`
 *          should be visible
 *        - The call page should resolve Neil as `instructorId`
 *
 * Audit trail:
 *   Every step writes a row to `auditLogs` with `actorId="system"`,
 *   `actorRole="system"`, and an action that names the affected table:
 *     - `reassign_workspace_instructor_from_duplicate`
 *     - `reassign_session_pack_instructor_from_duplicate`
 *     - `reassign_seat_reservation_instructor_from_duplicate`
 *     - `reassign_session_instructor_from_duplicate`
 *     - `soft_delete_duplicate_instructor`
 *     - `soft_delete_duplicate_user`
 *     - `queue_duplicate_clerk_user_for_deletion`
 *
 * Rollback:
 *   The mutation is forward-only (soft-delete + insert pendingClerkDeletion).
 *   To roll back BEFORE the Clerk cron runs, run each step below via
 *   `npx convex run --deployment fine-bulldog-260 <module>.js:<fn>` (or
 *   use a one-off internal mutation). WARNING: the `processPendingClerkDeletions`
 *   cron runs every ~5 minutes; if it has already started invoking the Clerk
 *   API for `user_3Jw6nFD2FxAA4631ZFRP7wkODsG`, stop it before rolling back
 *   (the Clerk account will already be gone by the time the row is restored).
 *     1. Delete the queued Clerk deletion FIRST so the cron does not delete the
 *        restored account:
 *          npx convex run --deployment fine-bulldog-260 \
 *            pendingClerkDeletions.js:removeForRollback \
 *            '{"clerkUserId":"user_3Jw6nFD2FxAA4631ZFRP7wkODsG"}'
 *        (or, if no such fn exists, `npx convex data ... pendingClerkDeletions`
 *        to find and delete the row by hand).
 *     2. `ctx.db.patch(jd748t2bzr76fh8wazzxwsv6tn8f8hhj, { deletedAt: undefined, isActive: true })`
 *     3. `ctx.db.patch(jd748t2bzr76fh8wazzxwsv6tn8f8hhj, { userId: "user_3Jw6nFD2FxAA4631ZFRP7wkODsG" })`
 *     4. `ctx.db.patch(j575hh3gp04w8asagws33gb0ks8f8apv, { deletedAt: undefined })`
 *     5. Manually reassign the four `instructorId` fields back to the duplicate
 *        (workspace, sessionPack, seatReservation, any sessions).
 *   After the Clerk cron runs the duplicate Clerk user is gone and a
 *   re-create would require a new Clerk account; record-only rollback
 *   is not possible from that point onward.
 */
export const RUNBOOK_NOTE = "replay-fixture-2026-10-12-niel-dup";
