import React from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getCurrentUser } from "@/lib/auth";
import { UploadsClient } from "./uploads-client";

interface User {
  _id: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

interface Assignment {
  _id: string;
  videoEditorId: string;
  instructorId?: string;
}

export default async function UploadsPage(): Promise<React.ReactElement> {
  const { userId, getToken } = await auth();

  if (!userId) {
    return (
      <div className="space-y-8 max-w-3xl">
        <div>
          <h1 className="text-3xl font-bold text-slate-100">Upload Files</h1>
          <p className="text-slate-400 mt-1">Please sign in to upload files</p>
        </div>
      </div>
    );
  }

  const token = await getToken({ template: "convex" }) ?? undefined;
  const dbUser = await getCurrentUser();
  let instructors: Array<{ id: string; name: string | null; email: string }> = [];
  // Admins can always upload unassigned. Video editors need at least one
  // active assignment (open or specific) to have any upload rights.
  let canUploadUnassigned = dbUser?.role === "admin";

  if (dbUser?.role === "video_editor") {
    const assignments = await fetchQuery(
      api.videoEditorAssignments.getVideoEditorAssignments,
      { videoEditorId: dbUser.userId },
      { token }
    ) as Assignment[];
    const hasOpenAssignment = assignments.some(
      (a) => a.instructorId === undefined
    );

    // Only active instructors are selectable targets, and only active
    // assignments grant upload rights. `getActiveUsersByRole` filters
    // deleted users/profiles and users no longer in the instructor role,
    // matching `isActiveInstructorTarget` in Convex. A stale assignment
    // must not surface the "Unassigned" option (the server rejects it).
    const activeInstructorUsers = await fetchQuery(
      api.users.getActiveUsersByRole,
      { role: "instructor" },
      { token }
    ) as User[];
    const assignedInstructorIds = new Set(
      assignments
        .map((a) => a.instructorId)
        .filter((id): id is string => id !== undefined)
    );

    const selectableInstructors = hasOpenAssignment
      ? activeInstructorUsers
      : activeInstructorUsers.filter((u) =>
          assignedInstructorIds.has(u.userId)
        );

    // Open access grants upload rights even if no active instructor
    // currently exists. Otherwise the editor needs at least one active
    // specific assignment.
    canUploadUnassigned =
      hasOpenAssignment || selectableInstructors.length > 0;

    instructors = selectableInstructors
      .map((u) => ({
        id: u.userId,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
        email: u.email || "",
      }))
      .sort((a, b) => {
        const an = (a.name || a.email).toLowerCase();
        const bn = (b.name || b.email).toLowerCase();
        return an.localeCompare(bn);
      });
  }

  return (
    <UploadsClient
      userRole={dbUser?.role || null}
      instructors={instructors}
      canUploadUnassigned={canUploadUnassigned}
    />
  );
}
