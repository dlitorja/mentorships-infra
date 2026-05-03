import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, currentUser } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { UnauthorizedError } from "@/lib/errors";

function getPrimaryEmail(user: Awaited<ReturnType<typeof currentUser>>): string | null {
  if (!user?.emailAddresses?.length) return null;
  
  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  if (primary) return primary.emailAddress;
  
  return user.emailAddresses[0]?.emailAddress ?? null;
}

async function requireAdminOrMentor(convex: ReturnType<typeof getConvexClient>, sessionPackId: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Authentication required");
  }

  const dbUser = await convex.query(api.users.getUserByUserId, { userId });
  const isAdmin = dbUser?.role === "admin";

  if (isAdmin) {
    return { userId, isAdmin: true };
  }

  const pack = await convex.query(api.sessionPacks.getSessionPackById, {
    id: sessionPackId as Id<"sessionPacks">,
  });

  if (!pack) {
    throw new Error("Session pack not found");
  }

  const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId });
  if (!instructor) {
    throw new UnauthorizedError("Mentor access required");
  }

  if (instructor._id !== pack.mentorId) {
    throw new UnauthorizedError("You can only modify session packs for your own mentees");
  }

  return { userId, isAdmin: false };
}

const updateSessionSchema = z.object({
  sessionPackId: z.string().min(1, "Invalid session pack ID"),
  action: z.enum(["increment", "decrement"]),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const convex = getConvexClient();
    const body = await request.json();
    const parseResult = updateSessionSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionPackId, action } = parseResult.data;
    await requireAdminOrMentor(convex, sessionPackId);

    if (action === "increment") {
      const updated = await convex.mutation(api.sessionPacks.addSessionsToPack, {
        id: sessionPackId as Id<"sessionPacks">,
        amount: 1,
      });
      return NextResponse.json({
        message: "Session added successfully",
        remainingSessions: updated?.remainingSessions,
        totalSessions: updated?.totalSessions,
      });
    } else {
      const updated = await convex.mutation(api.sessionPacks.removeSessionsFromPack, {
        id: sessionPackId as Id<"sessionPacks">,
        amount: 1,
      });
      return NextResponse.json({
        message: "Session removed successfully",
        remainingSessions: updated?.remainingSessions,
        totalSessions: updated?.totalSessions,
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