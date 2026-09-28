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

  if (dbUser?.role === "video_editor") {
    const assignments = await fetchQuery(
      api.videoEditorAssignments.getVideoEditorAssignments,
      { videoEditorId: dbUser.userId },
      { token }
    ) as Assignment[];
    const hasOpenAssignment = assignments.some((a) => a.instructorId === undefined);

    if (hasOpenAssignment) {
      const instructorUsers = await fetchQuery(
        api.users.getUsersByRole,
        { role: "instructor" },
        { token }
      ) as User[];

      instructors = instructorUsers
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
    } else {
      const instructorIds = assignments
        .map((a) => a.instructorId)
        .filter((id): id is string => id !== undefined);

      if (instructorIds.length > 0) {
        const instructorUsers = await fetchQuery(
          api.users.getUsersByUserIds,
          { userIds: instructorIds },
          { token }
        ) as User[];

        instructors = instructorUsers
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
    }
  }

  return (
    <UploadsClient
      userRole={dbUser?.role || null}
      instructors={instructors}
    />
  );
}
