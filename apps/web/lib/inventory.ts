import { db } from "@/lib/db";
import { mentors } from "@mentorships/db";
import { eq, desc } from "drizzle-orm";

export interface InstructorInventory {
  oneOnOneInventory: number;
  groupInventory: number;
}

export async function getInstructorInventory(
  slug: string
): Promise<InstructorInventory | null> {
  const instructor = await db.query.mentors.findFirst({
    where: eq(mentors.slug, slug),
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
  slug: string,
  updates: Partial<InstructorInventory>
): Promise<InstructorInventory | null> {
  const instructor = await db.query.mentors.findFirst({
    where: eq(mentors.slug, slug),
  });

  if (!instructor) {
    return null;
  }

  const currentOneOnOne = instructor.oneOnOneInventory ?? 0;
  const currentGroup = instructor.groupInventory ?? 0;

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
    .where(eq(mentors.slug, slug));

  return {
    oneOnOneInventory:
      updates.oneOnOneInventory ?? currentOneOnOne,
    groupInventory: updates.groupInventory ?? currentGroup,
  };
}

export async function decrementInventory(
  slug: string,
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
        eq(mentors.slug, slug),
        sql`${column} >= ${quantity}`
      )
    )
    .returning({ [column.name]: true });

  return result.length > 0;
}

import { sql, and } from "drizzle-orm";
