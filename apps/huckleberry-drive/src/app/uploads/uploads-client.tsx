"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadZone } from "@/components/upload-zone";
import { VideoEditorInstructorSelect } from "@/components/video-editor-instructor-select";

interface Instructor {
  id: string;
  name: string | null;
  email: string;
}

interface UploadsClientProps {
  userRole: string | null;
  instructors: Instructor[];
}

export function UploadsClient({
  userRole,
  instructors,
}: UploadsClientProps): React.ReactElement {
  const [selectedInstructorId, setSelectedInstructorId] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Upload Files</h1>
        <p className="text-slate-400 mt-1">
          {userRole === "video_editor"
            ? "Upload files for an assigned instructor"
            : userRole === "instructor" || userRole === "admin"
            ? "Upload video files to your storage"
            : "Upload video files"}
        </p>
      </div>

      {userRole === "video_editor" && (
        <VideoEditorInstructorSelect
          instructors={instructors}
          selectedInstructorId={selectedInstructorId}
          onSelect={setSelectedInstructorId}
        />
      )}

      {userRole === "video_editor" && !selectedInstructorId ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          Select an instructor before uploading files.
        </div>
      ) : (
        <UploadZone
          // PR1 (review): navigate on batch completion (after all
          // files from the most recent drop have settled) rather than
          // after the first file completes, otherwise the redirect
          // hides sibling uploads still in flight. UploadZone allows
          // two concurrent uploads.
          onBatchComplete={() => {
            router.push("/dashboard?uploaded=1");
          }}
          instructorId={userRole === "video_editor" ? selectedInstructorId ?? undefined : undefined}
        />
      )}
    </div>
  );
}