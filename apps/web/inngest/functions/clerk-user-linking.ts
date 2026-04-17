import { inngest } from "../client";
import { db, instructors, eq, ilike } from "@mentorships/db";

export const linkClerkUserToInstructor = inngest.createFunction(
  {
    id: "link-clerk-user-to-instructor",
    name: "Link Clerk User to Instructor",
    retries: 3,
  },
  { event: "clerk/user.created" },
  async ({ event, step }) => {
    const { userId, email } = event.data;

    const result = await step.run("link-instructor", async () => {
      const instructorsToLink = await db
        .select()
        .from(instructors)
        .where(ilike(instructors.email, email.toLowerCase()));

      if (instructorsToLink.length === 0) {
        return { linked: false, reason: "No instructor found with matching email", email };
      }

      const instructor = instructorsToLink[0];

      if (instructor.userId) {
        return { linked: false, reason: "Instructor already linked to a Clerk user", instructorId: instructor.id };
      }

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

    return result;
  }
);
