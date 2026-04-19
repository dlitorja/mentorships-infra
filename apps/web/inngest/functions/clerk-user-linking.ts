import { inngest } from "../client";
import { db, instructors, mentors, menteeInvitations, sessionPacks, eq, ilike, isNull, and, gt } from "@mentorships/db";

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

// If already linked to the same Clerk user, treat as success so we can complete the mentor backfill on retry
      if (instructor.userId && instructor.userId !== userId) {
        return { linked: false, reason: "Instructor already linked to a different Clerk user", instructorId: instructor.id };
      }

      // Use transaction for idempotency: check for existing mentor first, then create/update atomically
      const mentorId = await db.transaction(async (tx) => {
        // Check if mentor already exists for this user
        const existingMentor = await tx
          .select({ id: mentors.id })
          .from(mentors)
          .where(eq(mentors.userId, userId))
          .limit(1);

        const id =
          existingMentor[0]?.id ??
          (await tx.insert(mentors).values({ userId }).returning({ id: mentors.id }))[0].id;

        // Update instructor with both userId and mentorId atomically
        await tx
          .update(instructors)
          .set({ userId, mentorId: id, updatedAt: new Date() })
          .where(eq(instructors.id, instructor.id));

        return id;
      });

      return {
        linked: true,
        instructorId: instructor.id,
        instructorName: instructor.name,
        userId,
        mentorId,
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
