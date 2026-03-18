import { auth } from "@clerk/nextjs/server";
import { getUserById, UnauthorizedError, ForbiddenError, type users } from "@mentorships/db";

type DbUser = typeof users.$inferSelect;

export async function requireMentor(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getUserById(userId);
  if (!dbUser || (dbUser.role !== "mentor" && dbUser.role !== "admin")) {
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

export async function canAccessFile(fileInstructorId: string): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");
  
  const dbUser = await getUserById(userId);
  if (!dbUser) throw new UnauthorizedError("User not found");
  
  if (dbUser.role === "admin") return true;
  if (dbUser.role === "mentor" && fileInstructorId === userId) return true;
  
  throw new ForbiddenError("Cannot access this file");
}

export async function getCurrentUser(): Promise<DbUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  
  const dbUser = await getUserById(userId);
  return dbUser;
}