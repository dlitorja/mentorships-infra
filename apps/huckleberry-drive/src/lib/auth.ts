import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { PersistedUserRole } from "@/lib/api";

export class UnauthorizedError extends Error {
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

interface User {
  _id: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: PersistedUserRole;
  timeZone?: string;
  clerkId?: string;
}

export async function requireInstructor(): Promise<User> {
  const { userId, getToken } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!dbUser || (dbUser.role !== "instructor" && dbUser.role !== "admin" && dbUser.role !== "video_editor")) {
    throw new ForbiddenError("Must be an instructor, admin, or video editor");
  }
  return dbUser as User;
}

export async function requireAdmin(): Promise<User> {
  const { userId, getToken } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!dbUser || dbUser.role !== "admin") {
    throw new ForbiddenError("Must be an admin");
  }
  return dbUser as User;
}

export async function requireVideoEditor(): Promise<User> {
  const { userId, getToken } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!dbUser || dbUser.role !== "video_editor") {
    throw new ForbiddenError("Must be a video editor");
  }
  return dbUser as User;
}

export async function canAccessFile(fileInstructorId: string): Promise<boolean> {
  const { userId, getToken } = await auth();
  if (!userId) throw new UnauthorizedError("Must be logged in");

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!dbUser) throw new UnauthorizedError("User not found");

  if (dbUser.role === "admin") return true;
  if (dbUser.role === "instructor" && fileInstructorId === userId) return true;
  if (dbUser.role === "video_editor") {
    return await fetchQuery(api.videoEditorAssignments.isVideoEditorAssignedToInstructor, {
      videoEditorId: userId,
      instructorId: fileInstructorId,
    }, { token }) as boolean;
  }

  throw new ForbiddenError("Cannot access this file");
}

export async function getAccessibleInstructorIds(): Promise<string[] | null> {
  const { userId, getToken } = await auth();
  if (!userId) return [];

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  if (!dbUser) return [];

  if (dbUser.role === "admin") {
    return null;
  }

  if (dbUser.role === "instructor") {
    return [userId];
  }

  if (dbUser.role === "video_editor") {
    return await fetchQuery(api.videoEditorAssignments.getAssignedInstructorIds, { videoEditorId: userId }, { token }) as string[];
  }

  return [];
}

export async function getCurrentUser(): Promise<User | null> {
  const { userId, getToken } = await auth();
  if (!userId) return null;

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await fetchAction(api.users.getUserByClerkIdServer, { userId }, { token });
  return dbUser as User | null;
}