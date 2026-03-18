import { auth } from "@clerk/nextjs/server";
import { getUserById, UnauthorizedError, ForbiddenError, getAssignedInstructorIds, isVideoEditorAssignedToInstructor, type users } from "@mentorships/db";

type DbUser = typeof users.$inferSelect;

export async function requireMentor(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getUserById(userId);
  if (!dbUser || (dbUser.role !== "mentor" && dbUser.role !== "admin" && dbUser.role !== "video_editor")) {
    throw new ForbiddenError("Must be a mentor");
  }
  return dbUser;
}

export async function requireAdmin(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getUserById(userId);
  if (!dbUser || dbUser.role !== "admin") {
    throw new ForbiddenError("Must be an admin");
  }
  return dbUser;
}

export async function requireVideoEditor(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getUserById(userId);
  if (!dbUser || dbUser.role !== "video_editor") {
    throw new ForbiddenError("Must be a video editor");
  }
  return dbUser;
}

export async function canAccessFile(fileInstructorId: string): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getUserById(userId);
  if (!dbUser) throw new UnauthorizedError("User not found");
  
  if (dbUser.role === "admin") return true;
  if (dbUser.role === "mentor" && fileInstructorId === userId) return true;
  if (dbUser.role === "video_editor") {
    return isVideoEditorAssignedToInstructor(userId, fileInstructorId);
  }
  
  throw new ForbiddenError("Cannot access this file");
}

export async function getAccessibleInstructorIds(): Promise<string[]> {
  const { userId } = await auth();
  if (!userId) return [];
  
  const dbUser = await getUserById(userId);
  if (!dbUser) return [];
  
  if (dbUser.role === "admin") {
    return [];
  }
  
  if (dbUser.role === "mentor") {
    return [userId];
  }
  
  if (dbUser.role === "video_editor") {
    return getAssignedInstructorIds(userId);
  }
  
  return [];
}

export async function getCurrentUser(): Promise<DbUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  
  const dbUser = await getUserById(userId);
  return dbUser;
}