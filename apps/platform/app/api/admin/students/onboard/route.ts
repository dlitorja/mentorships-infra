import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { createStudentClerkInvitation } from "@/lib/clerk-invitations";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";

const onboardSchema = z.object({
  email: z.string().email("Invalid email address"),
  instructors: z
    .array(
      z.object({
        instructorId: z.string(),
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
export async function POST(req: NextRequest) {
  try {
    await requireAdminOrSupportForApi();

    const body = await req.json();
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
          instructorId: i.instructorId as any,
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
    if (nonRenewalInstructorIds.length > 0) {
      try {
        const result = await createStudentClerkInvitation({
          emailAddress: preview.email,
          redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/sign-up`,
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
          // Non-already-invited failure — log but continue; the DB
          // commit still succeeds and the admin can re-issue the
          // invite from the recovery dashboard.
          await reportError({
            source: "api:admin/students/onboard",
            error: new Error(errorMsg),
            level: "warn",
            message: "Clerk invitation failed for admin onboarding; continuing without it",
            context: { email: preview.email, errorMsg },
          });
        }
      } catch (err) {
        await reportError({
          source: "api:admin/students/onboard",
          error: err instanceof Error ? err : new Error(String(err)),
          level: "warn",
          message: "Clerk invitation threw for admin onboarding; continuing without it",
          context: { email: preview.email },
        });
      }
    }

    // 3. Commit the adminOnboardings row + per-pair artifacts.
    const commit = (await convex.mutation(
      api.adminOnboarding.adminOnboardStudent,
      {
        email: parsed.data.email,
        instructors: parsed.data.instructors.map((i) => ({
          instructorId: i.instructorId as any,
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
      // Match the existing pattern (payments.ts:552): DB success must not
      // be reported as failure if the Inngest send fails. Log + 200.
      await reportError({
        source: "api:admin/students/onboard",
        error: err instanceof Error ? err : new Error(String(err)),
        level: "warn",
        message: "Failed to emit admin/onboarding.completed Inngest event",
        context: { onboardingId: commit.onboardingId },
      });
    }

    return NextResponse.json(
      {
        onboardingId: commit.onboardingId,
        status: "processing" as const,
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
