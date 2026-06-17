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


  const dbUser = await fetchQuery(api.users.getUserByClerkIdPublic, { userId }) as User | null;
  let instructors: Array<{ id: string; name: string | null; email: string }> = [];

  if (dbUser?.role === "video_editor") {
    const assignments = await fetchQuery(api.videoEditorAssignments.getVideoEditorAssignments, { videoEditorId: userId }) as Assignment[];
    const instructorIds = assignments.map((a) => a.instructorId);

    if (instructorIds.length > 0) {
      const instructorUsers = await fetchQuery(api.users.getUsersByClerkIds, { userIds: instructorIds }) as User[];

      instructors = instructorUsers.map((u) => ({
        id: u.userId,
