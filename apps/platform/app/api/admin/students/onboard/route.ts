import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { createStudentClerkInvitation } from "@/lib/clerk-invitations";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";
import { convexIdSchema } from "@/lib/validators";
import { fingerprint } from "@/lib/log-fingerprint";
import { readJsonBody } from "@/lib/api/read-json-body";

const onboardSchema = z.object({
  email: z.string().email("Invalid email address"),
  instructors: z
    .array(
      z.object({
        instructorId: convexIdSchema,
        sessionsPerInstructor: z.number().int().min(1).default(4),
        expiresAt: z.number().int().positive().optional(),
      })
    )
    .min(1, "At least one instructor is required"),
  isSeparateStudentRecord: z.boolean().optional(),
  notes: z.string().optional(),
  capacityOverrideReason: z.string().optional(),
  source: z.enum(["kajabi", "manual", "import", "api"]).optional(),
});

type CommitResult = {
  onboardingId: string;
  perInstructor: Array<{
    instructorId: string;
    workspaceId: string | undefined;
    seatReservationId: string | undefined;
    sessionPackId: string | undefined;
    isRenewal: boolean;
    clerkInvitationId?: string;
  }>;
  existingWorkspaceIds: string[];
};

/**
 * Mark the row as `failed` via the bearer-auth HTTP endpoint. Does NOT
 * require a Clerk token — the endpoint validates exclusively against
 * `CONVEX_HTTP_KEY` (server-side shared bearer for trusted platform
 * callers). Greptile cloud finding (PR A): requiring a Clerk token
 * here would silently abort the recovery if the user session dropped
 * between commit and recovery.
 */
async function markOnboardingFailed(
  onboardingId: string,
  attemptCount: number,
  reason: string
): Promise<void> {
  try {
    await convexServerCall("/admin-onboarding/append-timeline", {
      onboardingId: onboardingId as Id<"adminOnboardings">,
      event: "failed",
      details: reason,
      expectedStatus: "processing",
      expectedAttemptCount: attemptCount,
    });
  } catch (err) {
    await reportError({
      source: "api:admin/students/onboard:mark-failed",
      error: err instanceof Error ? err : new Error(String(err)),
      level: "warn",
      message: "Could not mark onboarding as failed after Inngest send failure",
      context: { onboardingId, attemptCount },
    });
  }
}

/**
 * POST /api/admin/students/onboard
 *
 * Commit path of the two-phase form. Creates one Clerk invitation per
 * non-renewal instructor (keyed by instructorId), commits the
 * `adminOnboardings` row via the Convex mutation, and emits the
 * `admin/onboarding.completed` Inngest event with `attemptCount: 1`
 * (the stub flow in PR 2 marks the row completed; PR 3 replaces the
 * handler with the real Resend + Discord fan-out).
 *
 * Response: `{ onboardingId, status: "processing", perInstructor: [...] }`.
 *
 * Failure modes:
 *   - 400 invalid body.
 *   - 401 unauthorized.
 *   - 403 not admin/support.
 *   - 409 duplicate Clerk invitation (already invited).
 *   - 500 unexpected.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminOrSupportForApi();

    const body = await readJsonBody(req);
    if (body === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = onboardSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    // 1. Preview first so we know which pairs are renewals (no Clerk
    //    invite needed for renewals — the student already accepted one).
    const preview = await convex.query(
      api.adminOnboarding.previewAdminOnboarding,
      {
        email: parsed.data.email,
        instructors: parsed.data.instructors.map((i) => ({
          instructorId: i.instructorId as Id<"instructors">,
          sessionsPerInstructor: i.sessionsPerInstructor,
          expiresAt: i.expiresAt,
        })),
        isSeparateStudentRecord: parsed.data.isSeparateStudentRecord,
        notes: parsed.data.notes,
        capacityOverrideReason: parsed.data.capacityOverrideReason,
      }
    );

    // 2. Create a single Clerk invitation for the student. Clerk allows
    //    only one pending invitation per email, so we issue exactly one
    //    and reuse the returned invitationId for every non-renewal pair.
    //    Renewal pairs (existing student + existing seat) don't need a
    //    new invite — the Clerk account is already linked.
    const nonRenewalInstructorIds = preview.perInstructor
      .filter((p) => !p.isRenewal)
      .map((p) => p.instructorId);

    const clerkInvitationIds: Record<string, string> = {};
    let clerkInvitationId: string | undefined;
    let clerkInviteFailed = false;
    if (nonRenewalInstructorIds.length > 0) {
      // Guard: without NEXT_PUBLIC_APP_URL the redirect template literal
      // produces "undefined/sign-up", which Clerk rejects and silently
      // flips the row to failed on every attempt. Greptile cloud
      // finding.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!appUrl) {
        throw new Error(
          "NEXT_PUBLIC_APP_URL is not set; cannot build Clerk invitation redirect URL"
        );
      }
      try {
        const result = await createStudentClerkInvitation({
          emailAddress: preview.email,
          redirectUrl: `${appUrl}/sign-up`,
        });
        if (result.success && result.invitationId) {
          clerkInvitationId = result.invitationId;
          for (const id of nonRenewalInstructorIds) {
            clerkInvitationIds[id] = result.invitationId;
          }
        } else {
          const errorMsg = result.error ?? "unknown";
          const alreadyInvited = errorMsg.toLowerCase().includes("already");
          if (alreadyInvited) {
            return NextResponse.json(
              {
                error:
                  "A Clerk invitation already exists for this email. Cancel the existing invitation before submitting again.",
              },
              { status: 409 }
            );
          }
          clerkInviteFailed = true;
          // Non-already-invited failure — log but continue; the DB
          // commit still succeeds and the stub marks the row failed so
          // the admin can re-issue from the recovery dashboard.
          await reportError({
            source: "api:admin/students/onboard",
            error: new Error(errorMsg),
            level: "warn",
            message: "Clerk invitation failed for admin onboarding; continuing without it",
            context: {
              emailFingerprint: fingerprint(preview.email),
              errorMsg,
            },
          });
        }
      } catch (err) {
        clerkInviteFailed = true;
        await reportError({
          source: "api:admin/students/onboard",
          error: err instanceof Error ? err : new Error(String(err)),
          level: "warn",
          message: "Clerk invitation threw for admin onboarding; continuing without it",
          context: { emailFingerprint: fingerprint(preview.email) },
        });
      }
    }

    // 3. Commit the adminOnboardings row + per-pair artifacts.
    const commit = (await convex.mutation(
      api.adminOnboarding.adminOnboardStudent,
      {
        email: parsed.data.email,
        instructors: parsed.data.instructors.map((i) => ({
          instructorId: i.instructorId as Id<"instructors">,
          sessionsPerInstructor: i.sessionsPerInstructor,
          expiresAt: i.expiresAt,
        })),
        isSeparateStudentRecord: parsed.data.isSeparateStudentRecord,
        notes: parsed.data.notes,
        capacityOverrideReason: parsed.data.capacityOverrideReason,
        source: parsed.data.source ?? "kajabi",
        clerkInvitationIds,
      }
    )) as CommitResult;

    // Track whether we entered a recovery branch so the response can
    // surface the actual row status (instead of always reporting
    // "processing" — Greptile P1 finding: the form would render
    // `processing` forever for an onboarding already marked failed).
    let responseStatus: "processing" | "failed" = "processing";
    let failureReason: string | undefined;

    if (clerkInviteFailed) {
      // If Clerk failed, mark the row as `failed` immediately and skip
      // the Inngest send — the stub would also flip it to failed and
      // the admin's recovery path is via the dashboard retry (which
      // PR 3 will re-issue the invite). This avoids the row sitting in
      // `processing` with a missing signup link (Greptile P1 finding).
      await markOnboardingFailed(
        commit.onboardingId,
        1,
        "Clerk invitation failed during commit; admin must retry to issue invite."
      );
      responseStatus = "failed";
      failureReason = "Clerk invitation failed during commit; admin must retry to issue invite.";
    } else {
      // 4. Emit the Inngest event so the (stub) flow flips the row to
      //    completed. Idempotency key = `${onboardingId}:${attemptCount}`
      //    so admin retries bypass any cached runs (see plan §Idempotency).
      try {
        await inngest.send({
          name: "admin/onboarding.completed",
          data: {
            onboardingId: commit.onboardingId,
            attemptCount: 1,
          },
          id: `admin-onboarding:${commit.onboardingId}:1`,
        });
      } catch (err) {
        // If the event bus is unreachable, mark the row as `failed` so
        // the admin can retry from the recovery dashboard — otherwise
        // the row would be stuck in `processing` with no recovery path
        // (Greptile P1 finding).
        await reportError({
          source: "api:admin/students/onboard",
          error: err instanceof Error ? err : new Error(String(err)),
          level: "warn",
          message: "Failed to emit admin/onboarding.completed Inngest event",
          context: { onboardingId: commit.onboardingId, attemptCount: 1 },
        });
        await markOnboardingFailed(
          commit.onboardingId,
          1,
          "Inngest event send failed; admin must retry to restart flow."
        );
        responseStatus = "failed";
        failureReason = "Inngest event send failed; admin must retry to restart flow.";
      }
    }

    return NextResponse.json(
      {
        onboardingId: commit.onboardingId,
        status: responseStatus,
        failureReason,
        clerkInvitationId: clerkInvitationId ?? null,
        perInstructor: commit.perInstructor.map((p) => ({
          instructorId: p.instructorId,
          workspaceId: p.workspaceId,
          seatReservationId: p.seatReservationId,
          sessionPackId: p.sessionPackId,
          isRenewal: p.isRenewal,
          clerkInvitationId: clerkInvitationIds[p.instructorId],
        })),
        existingWorkspaceIds: commit.existingWorkspaceIds,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: admin or support role required" }, { status: 403 });
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.toLowerCase().includes("already")) {
      return NextResponse.json({ error: errorMessage }, { status: 409 });
    }

    console.error("Error creating admin onboarding:", error);
    return NextResponse.json({ error: "Failed to create admin onboarding" }, { status: 500 });
  }
}
