import { inngest } from "../client";
import { db, instructors, eq } from "@mentorships/db";

export const unlinkClerkUserFromInstructor = inngest.createFunction(
  {
    id: "unlink-clerk-user-from-instructor",
    name: "Unlink Clerk User from Instructor",
    retries: 3,
  },
  { event: "clerk/user.deleted" },
  async ({ event, step }) => {
    const { userId } = event.data;

    const result = await step.run("unlink-instructor", async () => {
      const instructorsToUnlink = await db
        .select()
        .from(instructors)
        .where(eq(instructors.userId, userId));

      if (instructorsToUnlink.length === 0) {
        return { unlinked: false, reason: "No instructor found with matching userId", userId };
      }

      const instructor = instructorsToUnlink[0];

      await db
        .update(instructors)
        .set({ userId: null, updatedAt: new Date() })
        .where(eq(instructors.id, instructor.id));

      return {
        unlinked: true,
        instructorId: instructor.id,
        instructorName: instructor.name,
        userId,
      };
    });

    return result;
  }
);
