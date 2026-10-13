import { inngest } from "../client";
import { db, instructors, eq, ilike } from "@mentorships/db";
import { convexServerCall } from "@/lib/convex-server-call";

type PendingStudentInvitation = {
  id: string;
  email: string;
  instructorId: string;
  clerkInvitationId: string | null;
  expiresAt: number;
  status: string;
  createdAt: number;
} | null;

type AcceptStudentInvitationResult =
  | { accepted: true; previousStatus: string }
  | { accepted: false; reason: string };

/**
 * Links a newly created Clerk user to an instructor or accepts a student invitation.
 *
 * Triggered by: `clerk/user.created`
 *
 * When a new Clerk user is created:
 * 1. Looks up instructors by email and updates userId if found
 * 2. Checks for pending student invitations via the bearer-auth HTTP endpoint
 *    `/internal/student-invitations/list-pending-by-email`, then flips the
 *    matching pending invitation to `accepted` via
 *    `/internal/student-invitations/accept-by-id` — both routes authenticate
 *    with `CONVEX_HTTP_KEY`.
 *
 * PR-B (Issue 3) motivation: previously this function called the public
 * `convex/studentInvitations.listStudentInvitations` / `updateStudentInvitationStatus`
 * mutations directly. After PR-B both are gated on admin-or-support role,
 * which this Inngest worker doesn't satisfy (it has no Clerk user
 * identity at run time — it authenticates as the deployment). Switching
 * to bearer-auth HTTP endpoints keeps the link-student flow alive while
 * the public mutations stay locked down.
 *
 * Skips if no email is provided. Instructor linking is idempotent (won't
 * overwrite a different Clerk user's link). Student invitation linking is
 * one-time (first Clerk user to match accepts the invitation).
 *
 * @returns Object with instructorLinking and studentLinking results
 */
export const linkClerkUserToInstructor = inngest.createFunction(
  {
    id: "link-clerk-user-to-instructor",
    name: "Link Clerk User to Instructor",
    retries: 3,
  },
  { event: "clerk/user.created" },
  async ({ event, step }) => {
    const { userId, email } = event.data;

    if (!email || typeof email !== "string") {
      return {
        linked: false,
        reason: "No email in event data, skipping",
        instructorLinking: { linked: false, reason: "No email provided" },
        studentLinking: { linked: false, reason: "No email provided" }
      };
    }

    const normalizedEmail = email.toLowerCase();

    const instructorResult = await step.run("link-instructor", async () => {
      const instructorsToLink = await db
        .select()
        .from(instructors)
        .where(ilike(instructors.email, normalizedEmail));

      if (instructorsToLink.length === 0) {
        return { linked: false, reason: "No instructor found with matching email", email };
      }

      const instructor = instructorsToLink[0];

      // If already linked to the same Clerk user, treat as success
      if (instructor.userId && instructor.userId !== userId) {
        return { linked: false, reason: "Instructor already linked to a different Clerk user", instructorId: instructor.id };
      }

      // Update instructor with userId only - no legacy bridge needed (Convex is source of truth)
      await db
        .update(instructors)
        .set({ userId, updatedAt: new Date() })
        .where(eq(instructors.id, instructor.id));

      return {
        linked: true,
        instructorId: instructor.id,
        instructorName: instructor.name,
        userId,
        email,
      };
    });

    const studentResult = await step.run("link-student", async () => {
      const findResponse = await convexServerCall<{ invitation: PendingStudentInvitation }>(
        "/internal/student-invitations/list-pending-by-email",
        { email: normalizedEmail }
      );

      const pendingInvitation = findResponse.invitation;
      if (!pendingInvitation) {
        return { linked: false, reason: "No pending student invitation found", email };
      }

      const acceptResponse = await convexServerCall<AcceptStudentInvitationResult>(
        "/internal/student-invitations/accept-by-id",
        { invitationId: pendingInvitation.id }
      );

      if (!acceptResponse.accepted) {
        return {
          linked: false,
          reason: `Pending invitation was not accepted: ${acceptResponse.reason}`,
          email,
        };
      }

      return {
        linked: true,
        invitationId: pendingInvitation.id,
        instructorId: pendingInvitation.instructorId,
        email,
        needsSessionPack: true,
        previousStatus: acceptResponse.previousStatus,
      };
    });

    return {
      instructorLinking: instructorResult,
      studentLinking: studentResult,
    };
  }
);
