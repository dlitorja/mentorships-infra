import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  incrementRemainingSessions,
  decrementRemainingSessions,
  getSessionPackById,
  getMentorByUserId,
} from "@mentorships/db";
import { getDbUser, UnauthorizedError } from "@/lib/auth";

function getPrimaryEmail(user: Awaited<ReturnType<typeof currentUser>>): string | null {
  if (!user?.emailAddresses?.length) return null;
  
  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  if (primary) return primary.emailAddress;
  
  return user.emailAddresses[0]?.emailAddress ?? null;
}

async function requireAdminOrMentor(sessionPackId: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Authentication required");
  }

  const user = await currentUser();
  const dbUser = await getDbUser();
  const userEmail = getPrimaryEmail(user);
  const isAdmin = dbUser?.role === "admin";

  if (isAdmin) {
    return { userId, isAdmin: true };
  }

  const mentor = await getMentorByUserId(userId);
  if (!mentor) {
    throw new UnauthorizedError("Mentor access required");
  }

  const pack = await getSessionPackById(sessionPackId);
  if (!pack) {
    throw new Error("Session pack not found");
  }

  if (mentor.id !== pack.mentorId) {
    throw new UnauthorizedError("You can only modify session packs for your own mentees");
  }

  return { userId, isAdmin: false };
}

const updateSessionSchema = z.object({
  sessionPackId: z.string().uuid("Invalid session pack ID"),
  action: z.enum(["increment", "decrement"]),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const parseResult = updateSessionSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionPackId, action } = parseResult.data;

    await requireAdminOrMentor(sessionPackId);

    if (action === "increment") {
      const updated = await incrementRemainingSessions(sessionPackId);
      return NextResponse.json({
        message: "Session added successfully",
        remainingSessions: updated.remainingSessions,
        totalSessions: updated.totalSessions,
      });
    } else {
      const updated = await decrementRemainingSessions(sessionPackId);
      return NextResponse.json({
        message: "Session removed successfully",
        remainingSessions: updated.remainingSessions,
        totalSessions: updated.totalSessions,
      });
    }
  } catch (error) {
    console.error("Error updating session count:", error);
    const status = 
      error instanceof Error && error.message.includes("not found") ? 404 :
      error instanceof Error && error.message.includes("Authentication") ? 401 :
      500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status }
    );
  }
}
