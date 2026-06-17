import React from "react";
import { auth } from "@clerk/nextjs/server";
import { getUserById } from "@mentorships/db";
import { getVideoEditorAssignments } from "@mentorships/db";
import { users } from "@mentorships/db/src/schema";
import { inArray } from "drizzle-orm";
import { db } from "@mentorships/db";
import { UploadsClient } from "./uploads-client";

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

  const dbUser = await getUserById(userId);
  let instructors: Array<{ id: string; name: string | null; email: string }> = [];

  if (dbUser?.role === "video_editor") {
    const assignments = await getVideoEditorAssignments(userId);
    const instructorIds = assignments.map((a) => a.instructorId);

    if (instructorIds.length > 0) {
      const instructorUsers = await db
        .select({
          id: users.id,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, instructorIds));

      instructors = instructorUsers.map((u) => ({
        id: u.id,
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