import { auth } from "@clerk/nextjs/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

export type DbUser = {
  id: string;
  role: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function getUserByClerkId(clerkId: string): Promise<{ userId: string; role: string } | null> {
  const convex = getConvexClient();
  try {
    const user = await convex.query(api.users.getCurrentUser, {});
    if (user && user.userId === clerkId) {
      return { userId: user.userId, role: user.role ?? "student" };
    }
  } catch {
    // Fall through
  }
  return null;
}

async function getAssignedInstructorIdsFromConvex(videoEditorId: string): Promise<string[]> {
  const convex = getConvexClient();
  try {
    const ids = await convex.query(api.videoEditorAssignments.getAssignedInstructors, {
      videoEditorId,
    });
    return ids;
  } catch {
    return [];
  }
}

async function canVideoEditorAccessInstructorFromConvex(
  videoEditorId: string,
  instructorId: string
): Promise<boolean> {
  const convex = getConvexClient();
  try {
    const result = await convex.query(api.videoEditorAssignments.canVideoEditorAccessInstructor, {
      videoEditorId,
      instructorId,
    });
    return result;
  } catch {
    return false;
  }
}

export async function requireInstructor(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const dbUser = await getUserByClerkId(userId);
  if (!dbUser || (dbUser.role !== "instructor" && dbUser.role !== "admin" && dbUser.role !== "video_editor")) {
    throw new ForbiddenError("Must be an instructor, admin, or video editor");
  }
  return { id: userId, role: dbUser.role };
}

export async function requireAdmin(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const dbUser = await getUserByClerkId(userId);
  if (!dbUser || dbUser.role !== "admin") {
    throw new ForbiddenError("Must be an admin");
  }
  return { id: userId, role: dbUser.role };
}

export async function requireVideoEditor(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const dbUser = await getUserByClerkId(userId);
  if (!dbUser || dbUser.role !== "video_editor") {
    throw new ForbiddenError("Must be a video editor");
  }
  return { id: userId, role: dbUser.role };
}

export async function canAccessFile(fileInstructorId: string): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const dbUser = await getUserByClerkId(userId);
  if (!dbUser) throw new UnauthorizedError("User not found");

  if (dbUser.role === "admin") return true;
  if (dbUser.role === "instructor" && fileInstructorId === userId) return true;
  if (dbUser.role === "video_editor") {
    return canVideoEditorAccessInstructorFromConvex(userId, fileInstructorId);
  }

  throw new ForbiddenError("Cannot access this file");
}

export async function getAccessibleInstructorIds(): Promise<string[] | null> {
  const { userId } = await auth();
  if (!userId) return [];

  const dbUser = await getUserByClerkId(userId);
  if (!dbUser) return [];

  if (dbUser.role === "admin") {
    return null;
  }

  if (dbUser.role === "instructor") {
    return [userId];
  }

  if (dbUser.role === "video_editor") {
    return getAssignedInstructorIdsFromConvex(userId);
  }

  return [];
}

export async function getCurrentUser(): Promise<DbUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const dbUser = await getUserByClerkId(userId);
  if (!dbUser) return null;
  return { id: userId, role: dbUser.role };
}