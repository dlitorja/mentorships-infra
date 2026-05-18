import { inngest } from "../client";
import { db, instructors, eq, ilike } from "@mentorships/db";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

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
      const convex = getConvexClient();
      const result = await convex.query(api.studentInvitations.listStudentInvitations, {
        status: "pending",
      });

      const pendingInvitation = (result.items as any[]).find(
        (inv: any) => inv.email.toLowerCase() === normalizedEmail
      );

      if (!pendingInvitation) {
        return { linked: false, reason: "No pending student invitation found", email };
      }

      await convex.mutation(api.studentInvitations.updateStudentInvitationStatus, {
        id: pendingInvitation.id,
        status: "accepted",
      });

      return {
        linked: true,
        invitationId: pendingInvitation.id,
        instructorId: pendingInvitation.instructorId,
        email,
        needsSessionPack: true,
      };
    });

    return {
      instructorLinking: instructorResult,
      studentLinking: studentResult,
    };
  }
);
