import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { mentors } from "@mentorships/db";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

type InventoryResponse =
  | { oneOnOneInventory: number; groupInventory: number }
  | { error: string; errorId: string };

type InventoryUpdateResponse =
  | { success: true; oneOnOneInventory: number; groupInventory: number }
  | { error: string; errorId: string };

const inventoryUpdateSchema = z.object({
  oneOnOneInventory: z.number().int().min(0).optional(),
  groupInventory: z.number().int().min(0).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: { slug: string } }
): Promise<NextResponse<InventoryResponse>> {
  const errorId = randomUUID();

  try {
    const { slug } = params;

    const instructor = await db.query.mentors.findFirst({
      where: eq(mentors.slug, slug),
      columns: {
        oneOnOneInventory: true,
        groupInventory: true,
      },
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found", errorId },
        { status: 404 }
      );
    }

    return NextResponse.json({
      oneOnOneInventory: instructor.oneOnOneInventory ?? 0,
      groupInventory: instructor.groupInventory ?? 0,
    });
  } catch (error) {
    console.error(`Inventory GET error [${errorId}]:`, error);
    return NextResponse.json(
      { error: "Failed to get inventory", errorId },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { slug: string } }
): Promise<NextResponse<InventoryUpdateResponse>> {
  const errorId = randomUUID();

  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required", errorId },
        { status: 401 }
      );
    }

    const { slug } = params;
    const body = await request.json();
    const validated = inventoryUpdateSchema.parse(body);

    const instructor = await db.query.mentors.findFirst({
      where: eq(mentors.slug, slug),
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found", errorId },
        { status: 404 }
      );
    }

    const currentOneOnOne = instructor.oneOnOneInventory ?? 0;
    const currentGroup = instructor.groupInventory ?? 0;

    const newOneOnOne = validated.oneOnOneInventory ?? currentOneOnOne;
    const newGroup = validated.groupInventory ?? currentGroup;

    await db.update(mentors)
      .set({
        oneOnOneInventory: newOneOnOne,
        groupInventory: newGroup,
        updatedAt: new Date(),
      })
      .where(eq(mentors.slug, slug));

    const shouldNotifyOneOnOne =
      currentOneOnOne === 0 && newOneOnOne > 0;
    const shouldNotifyGroup =
      currentGroup === 0 && newGroup > 0;

    if (shouldNotifyOneOnOne) {
      await inngest.send({
        name: "inventory/available",
        data: {
          instructorSlug: slug,
          type: "one-on-one",
          inventory: newOneOnOne,
        },
      });
    }

    if (shouldNotifyGroup) {
      await inngest.send({
        name: "inventory/available",
        data: {
          instructorSlug: slug,
          type: "group",
          inventory: newGroup,
        },
      });
    }

    return NextResponse.json({
      success: true,
      oneOnOneInventory: newOneOnOne,
      groupInventory: newGroup,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request data", errorId },
        { status: 400 }
      );
    }

    console.error(`Inventory PUT error [${errorId}]:`, error);
    return NextResponse.json(
      { error: "Failed to update inventory", errorId },
      { status: 500 }
    );
  }
}

const handler = {
  GET,
  PUT,
};

export { GET, PUT };
export default handler;
