import { db } from "@/lib/db";
import { instructorIntegrations } from "@mentorships/db";
import { eq, sql, and } from "drizzle-orm";

export interface InstructorInventory {
  oneOnOneInventory: number;
  groupInventory: number;
}

export async function getInstructorInventory(
  userId: string
): Promise<InstructorInventory | null> {
  const instructor = await db.query.instructorIntegrations.findFirst({
    where: eq(instructorIntegrations.userId, userId),
    columns: {
      oneOnOneInventory: true,
      groupInventory: true,
    },
  });

  if (!instructor) {
    return null;
  }

  return {
    oneOnOneInventory: instructor.oneOnOneInventory ?? 0,
    groupInventory: instructor.groupInventory ?? 0,
  };
}

export async function updateInstructorInventory(
  userId: string,
  updates: Partial<InstructorInventory>
): Promise<InstructorInventory | null> {
  const updateData: Partial<typeof instructorIntegrations.$inferSelect> = {
    updatedAt: new Date(),
  };

  if (updates.oneOnOneInventory !== undefined) {
    updateData.oneOnOneInventory = updates.oneOnOneInventory;
  }

  if (updates.groupInventory !== undefined) {
    updateData.groupInventory = updates.groupInventory;
  }

  const [updated] = await db
    .update(instructorIntegrations)
    .set(updateData)
    .where(eq(instructorIntegrations.userId, userId))
    .returning();

  if (!updated) {
    return null;
  }

  return {
    oneOnOneInventory: updated.oneOnOneInventory ?? 0,
    groupInventory: updated.groupInventory ?? 0,
  };
}

export async function decrementInventory(
  userId: string,
  type: "one-on-one" | "group",
  quantity: number = 1
): Promise<boolean> {
  const isOneOnOne = type === "one-on-one";

  const result = await db
    .update(instructorIntegrations)
    .set(
      isOneOnOne
        ? { oneOnOneInventory: sql`${instructorIntegrations.oneOnOneInventory} - ${quantity}`, updatedAt: new Date() }
        : { groupInventory: sql`${instructorIntegrations.groupInventory} - ${quantity}`, updatedAt: new Date() }
    )
    .where(
      isOneOnOne
        ? and(eq(instructorIntegrations.userId, userId), sql`${instructorIntegrations.oneOnOneInventory} >= ${quantity}`)
        : and(eq(instructorIntegrations.userId, userId), sql`${instructorIntegrations.groupInventory} >= ${quantity}`)
    )
    .returning({ userId: instructorIntegrations.userId });

  return result.length > 0;
}
