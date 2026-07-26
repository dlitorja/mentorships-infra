"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Save,
  Video,
} from "lucide-react";
import {
  getVideoEditors,
  updateVideoEditorAssignmentQuota,
  type VideoEditorWithAssignments,
  type VideoEditorAssignmentWithStorage,
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

function getInstructorName(instructor: { firstName?: string; lastName?: string; email: string } | null): string {
  if (!instructor) return "Unknown instructor";
  const name = [instructor.firstName, instructor.lastName].filter(Boolean).join(" ");
  return name || instructor.email;
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

  const handleSave = useCallback(async () => {
    setError(null);
    setIsSaving(true);
    try {
      const quota = value.trim() === "" ? null : gbToBytes(value);
      await updateVideoEditorAssignmentQuota(
        assignment.assignment.videoEditorId,
        assignment.assignment.instructorId,
        quota === null ? null : quota
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

export default function AdminVideoEditorsPage(): React.ReactElement {
  const [editors, setEditors] = useState<VideoEditorWithAssignments[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchEditors = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getVideoEditors();
      setEditors(data.editors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load video editors");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEditors();
  }, [fetchEditors]);

  const handleSaved = useCallback(() => {
    setSuccessMessage("Quota updated successfully");
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

              {assignments.length === 0 ? (
                <div className="px-6 py-4 text-sm text-slate-500">
                  No instructor assignments.
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
                    {assignments.map((assignment) => (
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
