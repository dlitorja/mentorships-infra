"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadZone } from "@/components/upload-zone";
import {
  UNASSIGNED_INSTRUCTOR_VALUE,
  VideoEditorInstructorSelect,
} from "@/components/video-editor-instructor-select";

interface Instructor {
  id: string;
  name: string | null;
  email: string;
}

interface UploadsClientProps {
  userRole: string | null;
  instructors: Instructor[];
  // True when the current user may upload without an instructor
  // (admins, and video editors with at least one active assignment).
  canUploadUnassigned: boolean;
}

export function UploadsClient({
  userRole,
  instructors,
  canUploadUnassigned,
}: UploadsClientProps): React.ReactElement {
  const [selectedInstructorId, setSelectedInstructorId] = useState<string | null>(null);
  const [adminUploadUnassigned, setAdminUploadUnassigned] = useState(false);
  const router = useRouter();

  const isVideoEditor = userRole === "video_editor";
  const isAdmin = userRole === "admin";

  const isUnassigned =
    isVideoEditor
      ? selectedInstructorId === UNASSIGNED_INSTRUCTOR_VALUE
      : isAdmin
        ? adminUploadUnassigned
        : false;

  // Video editors must make an explicit choice (instructor or unassigned)
  // before the upload zone becomes active. Treat the empty-string
  // placeholder as "no choice" too, otherwise re-selecting
  // "Select an instructor..." would bypass the guard.
  const needsSelection = isVideoEditor && !selectedInstructorId;

  // A video editor with no active assignments cannot upload at all, and
  // a video editor with assignments but no selectable instructors can
  // still only use the unassigned path.
  const hasNoUploadPath =
    isVideoEditor && instructors.length === 0 && !canUploadUnassigned;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Upload Files</h1>
        <p className="text-slate-400 mt-1">
          {isVideoEditor
            ? "Upload files for an instructor, or upload unassigned and assign later"
            : userRole === "instructor"
            ? "Upload video files to your storage"
            : "Upload video files"}
        </p>
      </div>

      {isVideoEditor && !hasNoUploadPath && (
        <VideoEditorInstructorSelect
          instructors={instructors}
          selectedInstructorId={selectedInstructorId}
          onSelect={setSelectedInstructorId}
          canUploadUnassigned={canUploadUnassigned}
        />
      )}

      {isAdmin && canUploadUnassigned && (
        <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={adminUploadUnassigned}
            onChange={(e) => setAdminUploadUnassigned(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-800"
          />
          <span>
            <span className="block text-sm font-medium text-slate-200">
              Upload unassigned
            </span>
            <span className="block text-xs text-slate-500">
              The files will have no instructor until you assign one from
              Admin → Files. Only you (and other admins) can see them in the
              meantime.
            </span>
          </span>
        </label>
      )}

      {hasNoUploadPath ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          You do not have any active instructor assignments yet. Ask an admin
          to assign you to an instructor before uploading files.
        </div>
      ) : needsSelection ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
          Select an instructor, or choose &quot;Unassigned — assign later&quot;
          before uploading files.
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
          instructorId={
            isVideoEditor && !isUnassigned
              ? selectedInstructorId ?? undefined
              : undefined
          }
          unassigned={isUnassigned}
        />
      )}
    </div>
  );
}
