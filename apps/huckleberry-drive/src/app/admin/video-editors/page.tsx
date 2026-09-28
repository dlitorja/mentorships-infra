"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Save,
  Video,
  Plus,
} from "lucide-react";
import {
  getVideoEditors,
  getAdminInstructors,
  updateVideoEditorAssignmentQuota,
  createVideoEditorAssignment,
  removeVideoEditorOpenAssignment,
  type VideoEditorWithAssignments,
  type VideoEditorAssignmentWithStorage,
  type InstructorOption,
} from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function bytesToGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

function gbToBytes(gb: string): number | null {
  const value = Number.parseFloat(gb);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 1024 * 1024 * 1024);
}

function getInstructorName(instructor: { firstName?: string | null; lastName?: string | null; email?: string | null } | null): string {
  if (!instructor) return "Unknown instructor";
  const name = [instructor.firstName, instructor.lastName].filter(Boolean).join(" ");
  return name || instructor.email || "Unknown instructor";
}

function AddAssignmentForm({
  videoEditorId,
  assignedInstructorIds,
  instructors,
  instructorsError,
  onAdded,
}: {
  videoEditorId: string;
  assignedInstructorIds: string[];
  instructors: InstructorOption[];
  instructorsError: string | null;
  onAdded: (message?: string) => void;
}): React.ReactElement {
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableInstructors = instructors.filter(
    (instructor) => !assignedInstructorIds.includes(instructor.id)
  );

  const handleAdd = useCallback(async () => {
    setError(null);
    if (!selectedInstructorId) return;
    setIsSaving(true);
    try {
      await createVideoEditorAssignment(videoEditorId, selectedInstructorId);
      setSelectedInstructorId("");
      onAdded("Instructor assigned successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add assignment");
    } finally {
      setIsSaving(false);
    }
  }, [selectedInstructorId, videoEditorId, onAdded]);

  if (instructorsError) {
    return (
      <div className="px-6 py-4 text-sm text-red-400">
        {instructorsError}
      </div>
    );
  }

  if (availableInstructors.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-slate-500">
        All instructors are already assigned to this editor.
      </p>
    );
  }

  return (
    <div className="px-6 py-4 border-t border-slate-700 bg-slate-800/20">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label htmlFor={`add-instructor-${videoEditorId}`} className="text-sm text-slate-400">
          Assign instructor:
        </label>
        <div className="flex items-center gap-2">
          <select
            id={`add-instructor-${videoEditorId}`}
            value={selectedInstructorId}
            onChange={(e) => setSelectedInstructorId(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 min-w-[200px]"
          >
            <option value="">Select an instructor...</option>
            {availableInstructors.map((instructor) => (
              <option key={instructor.id} value={instructor.id}>
                {instructor.name || instructor.email} ({instructor.email})
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedInstructorId || isSaving}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            Add
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function QuotaInput({
  assignment,
  onSaved,
}: {
  assignment: VideoEditorAssignmentWithStorage;
  onSaved: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(
    assignment.assignment.storageQuotaBytes === undefined
      ? ""
      : bytesToGB(assignment.assignment.storageQuotaBytes)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(
      assignment.assignment.storageQuotaBytes === undefined
        ? ""
        : bytesToGB(assignment.assignment.storageQuotaBytes)
    );
  }, [assignment.assignment.storageQuotaBytes]);

  const handleSave = useCallback(async () => {
    setError(null);
    setIsSaving(true);
    try {
      const trimmed = value.trim();
      let quota: number | null;
      if (trimmed === "") {
        quota = null;
      } else {
        quota = gbToBytes(trimmed);
        if (quota === null) {
          throw new Error("Enter a valid non-negative number of GB");
        }
      }
      if (assignment.assignment.instructorId === undefined) {
        throw new Error("Open assignments cannot have a per-instructor quota");
      }
      await updateVideoEditorAssignmentQuota(
        assignment.assignment.videoEditorId,
        assignment.assignment.instructorId,
        quota
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save quota");
    } finally {
      setIsSaving(false);
    }
  }, [value, assignment, onSaved]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <input
          type="number"
          min="0"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No limit"
          className="w-32 rounded-md border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
        />
        <span className="absolute right-3 top-1.5 text-xs text-slate-400">GB</span>
      </div>
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        aria-label="Save quota"
      >
        {isSaving ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Save className="w-3 h-3" />
        )}
        Save
      </button>
      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
}

function OpenAccessRow({
  assignment,
  onRevoked,
}: {
  assignment: VideoEditorAssignmentWithStorage;
  onRevoked: (message?: string) => void;
}): React.ReactElement {
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = useCallback(async () => {
    if (
      !window.confirm(
        "Revoke open access? The editor will only be able to upload to instructors listed in the table below."
      )
    ) {
      return;
    }
    setError(null);
    setIsRevoking(true);
    try {
      await removeVideoEditorOpenAssignment(assignment.assignment.videoEditorId);
      onRevoked("Open access revoked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke open access");
    } finally {
      setIsRevoking(false);
    }
  }, [assignment.assignment.videoEditorId, onRevoked]);

  return (
    <div className="px-6 py-4 border-b border-slate-700 bg-emerald-500/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
          Open access
        </span>
        <span className="text-sm text-slate-300">
          Can upload to any instructor (no quota)
        </span>
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-400">{error}</span>}
        <button
          onClick={handleRevoke}
          disabled={isRevoking}
          className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          {isRevoking ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : null}
          Revoke
        </button>
      </div>
    </div>
  );
}

function GrantOpenAccessButton({
  videoEditorId,
  onGranted,
}: {
  videoEditorId: string;
  onGranted: (message?: string) => void;
}): React.ReactElement {
  const [isGranting, setIsGranting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGrant = useCallback(async () => {
    if (
      !window.confirm(
        "Grant open access? This editor will be able to upload to any instructor without an explicit assignment."
      )
    ) {
      return;
    }
    setError(null);
    setIsGranting(true);
    try {
      await createVideoEditorAssignment(videoEditorId);
      onGranted("Open access granted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant open access");
    } finally {
      setIsGranting(false);
    }
  }, [videoEditorId, onGranted]);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={handleGrant}
        disabled={isGranting}
        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        {isGranting ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Plus className="w-3 h-3" />
        )}
        Grant open access
      </button>
    </div>
  );
}

export default function AdminVideoEditorsPage(): React.ReactElement {
  const [editors, setEditors] = useState<VideoEditorWithAssignments[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [instructorsError, setInstructorsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchEditors = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setInstructorsError(null);
      const data = await getVideoEditors();
      setEditors(data.editors);
      // Load instructors independently so a failure here does not hide the
      // existing quota-management UI.
      try {
        const instructorData = await getAdminInstructors();
        setInstructors(instructorData);
      } catch (instructorErr) {
        const message = instructorErr instanceof Error ? instructorErr.message : "Failed to load instructors";
        setInstructorsError(message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load video editors");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEditors();
  }, [fetchEditors]);

  const handleSaved = useCallback((message = "Quota updated successfully") => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
    void fetchEditors();
  }, [fetchEditors]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Video Editor Quotas</h1>
        <p className="text-slate-400 mt-1">
          Manage per-instructor storage quotas for video editors.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-sm hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          {successMessage}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="w-12 h-12 border-b-2 border-emerald-500 mx-auto animate-spin" />
            <p className="mt-4 text-slate-400">Loading video editors…</p>
          </div>
        </div>
      ) : editors.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No video editors found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {editors.map(({ editor, assignments }) => (
            <div
              key={editor.userId}
              className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50">
                <h2 className="text-lg font-semibold text-slate-200">
                  {[editor.firstName, editor.lastName].filter(Boolean).join(" ") || editor.email}
                </h2>
                <p className="text-sm text-slate-400">{editor.email}</p>
              </div>

              {(() => {
                const openAssignment = assignments.find(
                  (a) => a.assignment.instructorId === undefined
                );
                const specificAssignments = assignments.filter(
                  (a) => a.assignment.instructorId !== undefined
                );

                return (
                  <>
                    {openAssignment && (
                      <OpenAccessRow
                        assignment={openAssignment}
                        onRevoked={handleSaved}
                      />
                    )}
                    {specificAssignments.length === 0 ? (
                      <div className="px-6 py-4 text-sm text-slate-500">
                        {openAssignment
                          ? "No specific instructor assignments. The editor has open access."
                          : "No instructor assignments."}
                      </div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              Instructor
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              Used
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              Files
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              Quota
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {specificAssignments.map((assignment) => (
                            <tr
                              key={assignment.assignment._id}
                              className="hover:bg-slate-800/30 transition-colors"
                            >
                              <td className="px-6 py-4 text-sm text-slate-300">
                                {getInstructorName(assignment.instructor)}
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-300">
                                {formatBytes(assignment.usedBytes)}
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-300">
                                {assignment.fileCount}
                              </td>
                              <td className="px-6 py-4">
                                <QuotaInput
                                  assignment={assignment}
                                  onSaved={handleSaved}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="px-6 py-4 border-t border-slate-700 bg-slate-800/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <AddAssignmentForm
                        videoEditorId={editor.userId}
                        assignedInstructorIds={specificAssignments
                          .map((a) => a.assignment.instructorId)
                          .filter((id): id is string => id !== undefined)}
                        instructors={instructors}
                        instructorsError={instructorsError}
                        onAdded={handleSaved}
                      />
                      {!openAssignment && (
                        <GrantOpenAccessButton
                          videoEditorId={editor.userId}
                          onGranted={handleSaved}
                        />
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
