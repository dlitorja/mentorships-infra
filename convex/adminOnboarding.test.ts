/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * PR B: audit-atomicity tests for the bearer-auth HTTP endpoints
 * added to the admin-onboarding flow. Each test verifies that the
 * mutation endpoint writes BOTH the data change AND the audit row in
 * the same Convex transaction. If the audit row is missing, the
 * surrounding HTTP request would still 200 — that is the regression
 * these tests catch.
 *
 * Tested endpoints:
 *   - POST /admin-onboarding/append-timeline   → writes "append_timeline_entry_admin_onboarding" audit row
 *   - POST /admin-onboarding/mark-email-sent   → writes "mark_email_sent_admin_onboarding" audit row
 *   - POST /admin-onboarding/release-placeholder → writes "release_placeholder_inventory_admin_onboarding" audit row
 *   - POST /admin-onboarding/release-placeholder-batch → writes one audit row per onboardingId
 *
 * Auth: 401 path is covered in `convex/http.test.ts`. These tests
 * focus on the 200 path + atomicity.
 */

const VALID_KEY = "test-http-key-aob";

function bearerHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

async function seedAdminOnboardingRow(
  t: ReturnType<typeof convexTest>,
  email: string,
  status: "queued" | "processing" | "completed" | "failed" | "cancelled" = "processing",
  attemptCount = 1,
): Promise<{ onboardingId: string; instructorId: string }> {
  let onboardingId = "";
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      name: "Audit Instructor",
      slug: "audit-instructor",
      email: "audit-instructor@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    onboardingId = await ctx.db.insert("adminOnboardings", {
      email,
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status,
      attemptCount,
      perInstructor: [
        {
          instructorId: instructorId as any,
          isRenewal: false,
          sessionsPerInstructor: 4,
        },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [
        { at: Date.now(), event: "queued" },
      ],
      createdAt: Date.now(),
    });
  });
  return { onboardingId, instructorId };
}

test("audit-atomicity: /append-timeline writes append_timeline_entry_admin_onboarding audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "audit-append-1@example.com");

  const before = await t.run(async (ctx) => await ctx.db.query("auditLogs").collect());
  expect(before.length).toBe(0);

  const r = await t.fetch("/admin-onboarding/append-timeline", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ onboardingId, event: "processing_started" }),
  });
  expect(r.status).toBe(200);

  const after = await t.run(async (ctx) => await ctx.db.query("auditLogs").collect());
  expect(after.length).toBe(1);
  expect(after[0].action).toBe("append_timeline_entry_admin_onboarding");
  expect(after[0].targetType).toBe("adminOnboarding");
  expect(after[0].targetId).toBe(onboardingId);
  expect(after[0].actorId).toBe("platform-server");
  expect(after[0].actorRole).toBe("system");
  expect(after[0].metadata?.event).toBe("processing_started");
});

test("audit-atomicity: /mark-email-sent writes mark_email_sent_admin_onboarding audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "audit-mail-1@example.com");

  const r = await t.fetch("/admin-onboarding/mark-email-sent", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      onboardingId,
      recipient: { kind: "student" },
    }),
  });
  expect(r.status).toBe(200);

  const after = await t.run(async (ctx) => await ctx.db.query("auditLogs").collect());
  const markEmailSentRows = after.filter((l: any) => l.action === "mark_email_sent_admin_onboarding");
  expect(markEmailSentRows.length).toBe(1);
  expect(markEmailSentRows[0].targetId).toBe(onboardingId);
  expect(markEmailSentRows[0].actorRole).toBe("system");
  expect(markEmailSentRows[0].details).toContain("recipient=student");

  // The inner appendTimelineEntry also writes its own audit row, so
  // the total count is 2 (one per logical event).
  expect(after.length).toBe(2);
});

test("audit-atomicity: /release-placeholder writes release_placeholder_inventory_admin_onboarding audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "audit-rel-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ onboardingId, details: "audit-test-release" }),
  });
  expect(r.status).toBe(200);

  const after = await t.run(async (ctx) => await ctx.db.query("auditLogs").collect());
  const releaseRows = after.filter((l: any) => l.action === "release_placeholder_inventory_admin_onboarding");
  expect(releaseRows.length).toBe(1);
  expect(releaseRows[0].targetId).toBe(onboardingId);
  expect(releaseRows[0].actorRole).toBe("system");
  expect(releaseRows[0].details).toContain("seats=");
  expect(releaseRows[0].metadata?.source).toBe("audit-test-release");
});

test("audit-atomicity: /release-placeholder-batch writes one audit row per onboardingId", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const a = await seedAdminOnboardingRow(t, "audit-batch-1a@example.com", "completed");
  const b = await seedAdminOnboardingRow(t, "audit-batch-1b@example.com", "completed");
  const c = await seedAdminOnboardingRow(t, "audit-batch-1c@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder-batch", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      onboardingIds: [a.onboardingId, b.onboardingId, c.onboardingId],
      details: "audit-test-batch",
    }),
  });
  expect(r.status).toBe(200);

  const after = await t.run(async (ctx) => await ctx.db.query("auditLogs").collect());
  const releaseRows = after.filter((l: any) => l.action === "release_placeholder_inventory_admin_onboarding");
  expect(releaseRows.length).toBe(3);
  const targetIds = new Set(releaseRows.map((l: any) => l.targetId));
  expect(targetIds.has(a.onboardingId)).toBe(true);
  expect(targetIds.has(b.onboardingId)).toBe(true);
  expect(targetIds.has(c.onboardingId)).toBe(true);
});

// ---------------------------------------------------------------------------
// PR 12 PR 2: resendAdminOnboardingInvitation mutation tests
//
// The route at apps/platform/app/api/admin/onboardings/[id]/resend-invitation
// does the Clerk revoke + mint (Node runtime); the Convex mutation only
// patches perInstructor.clerkInvitationId, appends a timeline entry, and
// writes an audit row. These tests cover the mutation directly.
// ---------------------------------------------------------------------------

async function seedResendRow(
  t: ReturnType<typeof convexTest>,
  email: string,
  status: "queued" | "processing" | "completed" | "failed" | "cancelled",
): Promise<{ onboardingId: string; instructorId: string }> {
  let onboardingId = "";
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      name: "Resend Instructor",
      slug: `resend-${status}-${Math.random().toString(36).slice(2, 8)}`,
      email: "resend-instructor@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    onboardingId = await ctx.db.insert("adminOnboardings", {
      email,
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status,
      attemptCount: 1,
      perInstructor: [
        {
          instructorId: instructorId as any,
          isRenewal: false,
          sessionsPerInstructor: 4,
          clerkInvitationId: "inv_old_xxx",
        },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [{ at: Date.now(), event: "queued" }],
      createdAt: Date.now(),
    });
  });
  return { onboardingId, instructorId };
}

async function seedAdminUser(t: ReturnType<typeof convexTest>, subject: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: `${subject}@example.com`,
      role: "admin",
    });
  });
}

test("resendAdminOnboardingInvitation: happy path (queued) writes timeline entry + audit row + new invitationId", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_admin_resend_queued";
  await seedAdminUser(t, subject);
  const { onboardingId } = await seedResendRow(t, "resend-queued@example.com", "queued");

  const result = await t
    .withIdentity({ subject })
    .mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
      onboardingId: onboardingId as any,
      newInvitationId: "inv_new_yyy",
    });

  expect(result.previousStatus).toBe("queued");
  expect(result.previousInvitationIds).toEqual(["inv_old_xxx"]);
  expect(result.newInvitationId).toBe("inv_new_yyy");

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.perInstructor[0].clerkInvitationId).toBe("inv_new_yyy");
  const lastTimeline = row?.timeline[row.timeline.length - 1];
  expect(lastTimeline?.event).toBe("invitation_resent");
  expect(lastTimeline?.actorUserId).toBe(subject);
  expect(lastTimeline?.details).toContain("prev=inv_old_xxx");
  expect(lastTimeline?.details).toContain("new=inv_new_yyy");
  // Row status is unchanged — the mutation does not auto-retry.
  expect(row?.status).toBe("queued");

  const audit = await t.run(async (ctx) => await ctx.db.query("auditLogs").collect());
  const resendAudit = audit.filter((l: any) => l.action === "resend_admin_onboarding_invitation");
  expect(resendAudit.length).toBe(1);
  expect(resendAudit[0].targetId).toBe(onboardingId);
  expect(resendAudit[0].actorId).toBe(subject);
  expect(resendAudit[0].actorRole).toBe("admin");
  expect(resendAudit[0].metadata?.newInvitationId).toBe("inv_new_yyy");
  expect(resendAudit[0].metadata?.previousInvitationIds).toEqual(["inv_old_xxx"]);
  expect(resendAudit[0].metadata?.previousStatus).toBe("queued");
});

test("resendAdminOnboardingInvitation: failed row keeps status 'failed' (route chains retry, mutation does not)", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_admin_resend_failed";
  await seedAdminUser(t, subject);
  const { onboardingId } = await seedResendRow(t, "resend-failed@example.com", "failed");

  await t
    .withIdentity({ subject })
    .mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
      onboardingId: onboardingId as any,
      newInvitationId: "inv_new_zzz",
    });

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.perInstructor[0].clerkInvitationId).toBe("inv_new_zzz");
  // Mutation does not flip status — the route chains retryAdminOnboarding
  // separately when the prior status was 'failed'.
  expect(row?.status).toBe("failed");
});

test("resendAdminOnboardingInvitation: refuses on terminal 'completed' status", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_admin_resend_completed";
  await seedAdminUser(t, subject);
  const { onboardingId } = await seedResendRow(t, "resend-completed@example.com", "completed");

  await expect(
    t
      .withIdentity({ subject })
      .mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
        onboardingId: onboardingId as any,
        newInvitationId: "inv_new_terminal",
      })
  ).rejects.toThrow(/terminal/);

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  // clerkInvitationId unchanged.
  expect(row?.perInstructor[0].clerkInvitationId).toBe("inv_old_xxx");
});

test("resendAdminOnboardingInvitation: refuses on terminal 'cancelled' status", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_admin_resend_cancelled";
  await seedAdminUser(t, subject);
  const { onboardingId } = await seedResendRow(t, "resend-cancelled@example.com", "cancelled");

  await expect(
    t
      .withIdentity({ subject })
      .mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
        onboardingId: onboardingId as any,
        newInvitationId: "inv_new_cancelled",
      })
  ).rejects.toThrow(/terminal/);
});

test("resendAdminOnboardingInvitation: throws 'Forbidden' for non-admin caller", async () => {
  const t = convexTest(schema, modules);
  const subject = "user_student_caller";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: subject,
      clerkId: subject,
      email: `${subject}@example.com`,
      role: "student",
    });
  });
  const { onboardingId } = await seedResendRow(t, "resend-forbidden@example.com", "queued");

  await expect(
    t
      .withIdentity({ subject })
      .mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
        onboardingId: onboardingId as any,
        newInvitationId: "inv_new_forbidden",
      })
  ).rejects.toThrow(/Forbidden/);
});
