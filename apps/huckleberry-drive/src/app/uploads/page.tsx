import React from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { UploadsClient } from "./uploads-client";

interface User {
  _id: string;
  userId: string;
  email: string;
  role: string;
}

interface Assignment {
  _id: string;
  videoEditorId: string;
  instructorId: string;
}

export default async function UploadsPage(): Promise<React.ReactElement> {
  const { userId } = await auth();

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

  const dbUser = await fetchQuery(api.users.getUserByClerkIdPublic, { userId }) as User | null;
  let instructors: Array<{ id: string; name: string | null; email: string }> = [];

  if (dbUser?.role === "video_editor") {
    const assignments = await fetchQuery(api.videoEditorAssignments.getVideoEditorAssignments, { videoEditorId: userId }) as Assignment[];
    const instructorIds = assignments.map((a) => a.instructorId);

    if (instructorIds.length > 0) {
      const instructorUsers = await fetchQuery(api.users.getUsersByClerkIds, { userIds: instructorIds }) as User[];

      instructors = instructorUsers.map((u) => ({
        id: u.userId,
        name: null,
        email: u.email || "",
      }));
    }
  }

  return (
    <UploadsClient
      userRole={dbUser?.role || null}
      instructors={instructors}
    />
  );
}