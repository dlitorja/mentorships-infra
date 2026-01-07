import { db } from "@/lib/db";
import { mentors } from "@mentorships/db";
import { eq, sql, and } from "drizzle-orm";

export interface InstructorInventory {
  oneOnOneInventory: number;
  groupInventory: number;
}

export async function getInstructorInventory(
  userId: string
): Promise<InstructorInventory | null> {
  const instructor = await db.query.mentors.findFirst({
    where: eq(mentors.userId, userId),
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
  const updateData: Partial<typeof mentors.$inferSelect> = {
    updatedAt: new Date(),
  };

  if (updates.oneOnOneInventory !== undefined) {
    updateData.oneOnOneInventory = updates.oneOnOneInventory;
  }

  if (updates.groupInventory !== undefined) {
    updateData.groupInventory = updates.groupInventory;
  }

  await db
    .update(mentors)
    .set(updateData)
    .where(eq(mentors.userId, userId));

  return {
    oneOnOneInventory: updates.oneOnOneInventory ?? 0,
    groupInventory: updates.groupInventory ?? 0,
  };
}

export async function decrementInventory(
  userId: string,
  type: "one-on-one" | "group",
  quantity: number = 1
): Promise<boolean> {
  const column =
    type === "one-on-one" ? mentors.oneOnOneInventory : mentors.groupInventory;

  const result = await db
    .update(mentors)
    .set({
      [column.name]: sql`${column} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mentors.userId, userId),
        sql`${column} >= ${quantity}`
      )
    )
    .returning({ newQty: column });

  return result.length > 0 && (result[0]?.newQty ?? 0) >= 0;
}
