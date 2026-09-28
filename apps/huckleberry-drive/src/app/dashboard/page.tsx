import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getCurrentUser, getAccessibleInstructorIds } from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";
import { isUserRole } from "@/lib/api";

interface InstructorInfo {
  id: string;
  name: string | null;
  email: string | null;
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const { userId, getToken } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const dbUser = await getCurrentUser();
  if (!dbUser) {
    redirect("/sign-in");
  }

  const role = isUserRole(dbUser.role) ? dbUser.role : null;
  if (!role) {
    redirect("/sign-in");
  }

  let instructorIds = (await getAccessibleInstructorIds()) ?? [];

  // Instructors own their own storage; use the Convex `userId` (the ID used by
  // the upload route and storage accounting) rather than the Clerk ID, so the
  // dashboard query matches the uploaded instructorId.
  if (role === "instructor") {
    instructorIds = [dbUser.userId];
  }

  // For video editors with an open assignment, the editor can upload to ANY
  // instructor — including those they have no specific assignment for. The
  // dashboard switcher must therefore list every invited instructor when
  // open access is present, regardless of whether specific assignments also
  // exist. Without this, an editor with both open and specific assignments
  // would see only the specific ones in the dashboard even though they
  // can upload to the others.
  if (role === "video_editor") {
    const token = await getToken({ template: "convex" }) ?? undefined;
    const openAssignment = await fetchQuery(
      api.videoEditorAssignments.getVideoEditorOpenAssignment,
      { videoEditorId: dbUser.userId },
      { token }
    );
    if (openAssignment) {
      const allInstructors = await fetchQuery(
        api.users.getActiveUsersByRole,
        { role: "instructor" },
        { token }
      ) as Array<{ userId: string }>;
      instructorIds = allInstructors.map((u) => u.userId);
    }
  }

  // Resolve instructor names so the video editor selector shows useful labels.
  let instructors: InstructorInfo[] = [];
  if (instructorIds.length > 0) {
    const token = await getToken({ template: "convex" }) ?? undefined;
    const users = await fetchQuery(
      api.users.getUsersByClerkIds,
      { userIds: instructorIds },
      { token }
    ) as Array<{ userId: string; firstName?: string | null; lastName?: string | null; email?: string | null }>;
    const userById = new Map(users.map((u) => [u.userId, u]));
    instructors = instructorIds.map((id) => {
      const user = userById.get(id);
      const name = user
        ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || null
        : null;
      return { id, name, email: user?.email ?? null };
    });
  }

  // Use the Convex `userId` as the canonical dashboard identity. The upload API
  // persists this same ID as uploadedById, so "Files I Uploaded" matches.
  return (
    <DashboardClient
      initialUserRole={role}
      initialUserId={dbUser.userId}
      initialInstructorIds={instructorIds}
      instructors={instructors}
    />
  );
}
