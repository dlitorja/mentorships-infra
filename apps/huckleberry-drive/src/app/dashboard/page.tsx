import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCurrentUser, getAccessibleInstructorIds } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";
import type { UserRole } from "@/lib/api";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const dbUser = await getCurrentUser();
  if (!dbUser) {
    redirect("/sign-in");
  }

  const role = dbUser.role as UserRole | null;
  let instructorIds = (await getAccessibleInstructorIds()) ?? [];

  // Instructors own their own storage; use the Convex `userId` (the ID used by
  // the upload route and storage accounting) rather than the Clerk ID, so the
  // dashboard query matches the uploaded instructorId.
  if (role === "instructor") {
    instructorIds = [dbUser.userId];
  }

  // Use the Convex `userId` as the canonical dashboard identity. The upload API
  // persists this same ID as uploadedById, so "Files I Uploaded" matches.
  return (
    <DashboardClient
      initialUserRole={role}
      initialUserId={dbUser.userId}
      initialInstructorIds={instructorIds}
    />
  );
}
