import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { mentors } from "@mentorships/db";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

const ADMIN_EMAILS = process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim()) || [
  "admin@huckleberry.art",
];

type InventoryResponse =
  | { oneOnOneInventory: number; groupInventory: number }
  | { error: string; errorId: string };

type InventoryUpdateResponse =
  | { success: true; oneOnOneInventory: number; groupInventory: number }
  | { error: string; errorId: string };

const inventoryQuerySchema = z.object({
  userId: z.string().min(1),
});

const inventoryUpdateSchema = z.object({
  userId: z.string().min(1),
  oneOnOneInventory: z.number().int().min(0).optional(),
  groupInventory: z.number().int().min(0).optional(),
});

async function handleGet(
  request: Request
): Promise<NextResponse<InventoryResponse>> {
  const errorId = randomUUID();

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    const validated = inventoryQuerySchema.parse({ userId });

    const instructor = await db.query.mentors.findFirst({
      where: eq(mentors.userId, validated.userId),
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request", errorId },
        { status: 400 }
      );
    }
    console.error(`Inventory GET error [${errorId}]:`, error);
    return NextResponse.json(
      { error: "Failed to get inventory", errorId },
      { status: 500 }
    );
  }
}

async function handlePut(
  request: Request
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

    const user = await currentUser();
    const userEmail = user?.emailAddresses?.[0]?.emailAddress;
    const isAdmin = userEmail ? ADMIN_EMAILS.includes(userEmail) : false;

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Admin access required", errorId },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validated = inventoryUpdateSchema.parse(body);

    const instructor = await db.query.mentors.findFirst({
      where: eq(mentors.userId, validated.userId),
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
      .where(eq(mentors.userId, validated.userId));

    const shouldNotifyOneOnOne =
      currentOneOnOne === 0 && newOneOnOne > 0;
    const shouldNotifyGroup =
      currentGroup === 0 && newGroup > 0;

    if (shouldNotifyOneOnOne) {
      try {
        await inngest.send({
          name: "inventory/available",
          data: {
            instructorUserId: validated.userId,
            type: "one-on-one",
            inventory: newOneOnOne,
          },
        });
      } catch (notifyError) {
        console.error(
          `Failed to send one-on-one notification for user ${validated.userId}:`,
          notifyError
        );
      }
    }

    if (shouldNotifyGroup) {
      try {
        await inngest.send({
          name: "inventory/available",
          data: {
            instructorUserId: validated.userId,
            type: "group",
            inventory: newGroup,
          },
        });
      } catch (notifyError) {
        console.error(
          `Failed to send group notification for user ${validated.userId}:`,
          notifyError
        );
      }
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

export const GET = handleGet;
export const PUT = handlePut;
