import { inngest } from "../client";
import { db, instructors, menteeInvitations, eq, ilike, and, gt } from "@mentorships/db";

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
        menteeLinking: { linked: false, reason: "No email provided" }
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

      // Update instructor with userId only - no mentorId bridge needed (Convex is source of truth)
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

    const menteeResult = await step.run("link-mentee", async () => {
      const pendingInvitation = await db
        .select()
        .from(menteeInvitations)
        .where(
          and(
            eq(menteeInvitations.email, normalizedEmail),
            eq(menteeInvitations.status, "pending"),
            gt(menteeInvitations.expiresAt, new Date())
          )
        )
        .limit(1);

      if (pendingInvitation.length === 0) {
        return { linked: false, reason: "No pending mentee invitation found", email };
      }

      const invitation = pendingInvitation[0];

      await db
        .update(menteeInvitations)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(eq(menteeInvitations.id, invitation.id));

      return {
        linked: true,
        invitationId: invitation.id,
        mentorId: invitation.instructorId,
        email,
        needsSessionPack: true,
      };
    });

    return {
      instructorLinking: instructorResult,
      menteeLinking: menteeResult,
    };
  }
);
