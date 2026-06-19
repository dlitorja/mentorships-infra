"use client";

import React, { useState, useCallback } from "react";
import {
  Film,
  Download,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Cloud,
  Loader2,
  RotateCcw,
  Play,
  X,
} from "lucide-react";
import { deleteFile, getDownloadUrl, restoreFile, hardDeleteFile, getStreamUrl } from "@/lib/api";
import type { FileItem } from "@/lib/api";

type UserRole = "student" | "instructor" | "admin" | "video_editor";

interface FileListProps {
  files: FileItem[];
  onFilesChange: () => void;
  userRole?: UserRole;
  userId?: string;
  showInstructorColumn?: boolean;
  showUploadedByColumn?: boolean;
  onHardDelete?: (fileId: string) => void;
  instructorNames?: Record<string, string>;
}

const GRACE_PERIOD_DAYS = 60;
const WARNING_THRESHOLD_DAYS = 50;

export function FileList({
  files,
  onFilesChange,
  userRole,
  userId,
  showInstructorColumn = false,
  showUploadedByColumn = false,
  onHardDelete,
  instructorNames = {},
}: FileListProps): React.ReactElement {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmHardDeleteId, setConfirmHardDeleteId] = useState<string | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  const [playingVideoContentType, setPlayingVideoContentType] = useState<string>("video/mp4");

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getDaysUntilPermanentDelete = (deletedAt: number): number | null => {
    const now = Date.now();
    const daysElapsed = (now - deletedAt) / (1000 * 60 * 60 * 24);
    const daysRemaining = GRACE_PERIOD_DAYS - daysElapsed;
    if (daysRemaining <= 0) return null;
    return Math.ceil(daysRemaining);
  };

  const canRestore = (file: FileItem): boolean => {
    if (!userRole || !userId) return false;
    if (userRole === "admin") return true;
    if (userRole === "instructor" && file.instructorId === userId) return true;
    return false;
  };

  const canHardDelete = (): boolean => {
return userRole === "admin";
  };

  const getStatusDisplay = (
    status: string,
    transferStatus: string | null
  ): { icon: React.ReactNode; text: string; color: string } => {
    if (status === "deleted") {
      return {
        icon: <Trash2 className="w-4 h-4" />,
        text: "Deleted",
        color: "text-slate-500",
      };
    }
    if (status === "failed" || transferStatus === "failed") {
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        text: "Failed",
        color: "text-red-400",
      };
    }
    if (status === "archived") {
      return {
        icon: <Cloud className="w-4 h-4" />,
        text: "Archived to Cloud",
        color: "text-blue-400",
      };
    }
    if (status === "completed" && transferStatus === "transferring") {
      return {
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        text: "Archiving...",
        color: "text-yellow-400",
      };
    }
    if (status === "completed" || status === "uploading") {
      return {
        icon: <CheckCircle2 className="w-4 h-4" />,
        text: "On B2",
        color: "text-emerald-400",
      };
    }
    if (status === "pending") {
      return {
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        text: "Pending",
        color: "text-slate-400",
      };
    }
    return {
      icon: <AlertCircle className="w-4 h-4" />,
      text: status,
      color: "text-slate-400",
    };
  };

  const handleDownload = useCallback(async (file: FileItem) => {
    setDownloadingIds((prev) => new Set(prev).add(file.id));
    try {
      const url = await getDownloadUrl(file.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  }, []);

  const handleDelete = useCallback(
    async (fileId: string) => {
      setDeletingId(fileId);
      setConfirmDeleteId(null);
      try {
        await deleteFile(fileId);
        onFilesChange();
      } catch (error) {
        console.error("Delete failed:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [onFilesChange]
  );

  const handleRestore = useCallback(
    async (fileId: string) => {
      setRestoringId(fileId);
      try {
        await restoreFile(fileId);
        onFilesChange();
      } catch (error) {
        console.error("Restore failed:", error);
      } finally {
        setRestoringId(null);
      }
    },
    [onFilesChange]
  );

  const handleHardDelete = useCallback(
    async (fileId: string) => {
      setDeletingId(fileId);
      setConfirmHardDeleteId(null);
      try {
        if (onHardDelete) {
          await onHardDelete(fileId);
        } else {
          await hardDeleteFile(fileId);
        }
        onFilesChange();
      } catch (error) {
        console.error("Hard delete failed:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [onFilesChange, onHardDelete]
  );

  const handlePlay = useCallback(async (file: FileItem) => {
    if (!file.contentType.startsWith("video/")) return;
    setDownloadingIds((prev) => new Set(prev).add(file.id));
    try {
      const url = await getStreamUrl(file.id);
      setPlayingVideoUrl(url);
      setPlayingVideoContentType(file.contentType);
    } catch (error) {
      console.error("Play failed:", error);
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  }, []);

  if (files.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <Film className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No files uploaded yet</p>
        <p className="text-sm mt-1">Go to the Uploads page to add your first video</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/50">
            {showInstructorColumn && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Instructor
              </th>
            )}
            {showUploadedByColumn && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Uploaded By
              </th>
            )}
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
              File
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Size
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Uploaded
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {files.map((file) => {
            const statusDisplay = getStatusDisplay(
              file.status,
              file.transferStatus
            );
            const isDeleting = deletingId === file.id;
            const isDownloading = downloadingIds.has(file.id);
            const isConfirming = confirmDeleteId === file.id;
            const isRestoring = restoringId === file.id;
            const isConfirmingHardDelete = confirmHardDeleteId === file.id;

            const daysRemaining = file.deletedAt
              ? getDaysUntilPermanentDelete(file.deletedAt)
              : null;
            const showWarningBadge = daysRemaining !== null && daysRemaining <= WARNING_THRESHOLD_DAYS;

            const canRestoreThisFile = canRestore(file);
            const canHardDeleteThisFile = canHardDelete();

            return (
              <tr key={file.id} className="hover:bg-slate-800/30 transition-colors">
                {showInstructorColumn && (
                  <td className="px-4 py-3 text-slate-400">
                    {instructorNames[file.instructorId || ""] || file.instructorId || "-"}
                  </td>
                )}
                {showUploadedByColumn && (
                  <td className="px-4 py-3 text-slate-400">
                    {file.uploadedById || "-"}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Film className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="font-medium text-slate-200 truncate max-w-xs">
                      {file.originalName}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{formatBytes(file.size)}</td>
                <td className="px-4 py-3 text-slate-400">{formatDate(file.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <div className={`flex items-center gap-2 ${statusDisplay.color}`}>
                      {statusDisplay.icon}
                      <span className="text-sm">{statusDisplay.text}</span>
                    </div>
                    {showWarningBadge && daysRemaining !== null && (
                      <span className="text-xs text-amber-400">
                        Deletes in {daysRemaining} days
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {isConfirmingHardDelete ? (
                      <>
                        <button
                          onClick={() => handleHardDelete(file.id)}
                          disabled={isDeleting}
                          className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting..." : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmHardDeleteId(null)}
                          className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                        >
                          Cancel
                        </button>
                      </>
                    ) : isConfirming ? (
                      <>
                        <button
                          onClick={() => handleDelete(file.id)}
                          disabled={isDeleting}
                          className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting..." : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1.5 text-xs font-medium bg-slate-600 text-slate-300 rounded-md hover:bg-slate-500"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
{file.status !== "deleted" && (
                          <>
                            {file.contentType.startsWith("video/") && (
                              <button
                                onClick={() => handlePlay(file)}
                                disabled={isDownloading}
                                className="p-2 rounded-lg hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                                title="Play"
                                aria-label="Play video"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDownload(file)}
                              disabled={isDownloading}
                              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                              title="Download"
                              aria-label="Download"
                            >
                              {isDownloading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4" />
                              )}
                            </button>
                          </>
                        )}
                        {file.status === "deleted" && canRestoreThisFile && (
                          <button
                            onClick={() => handleRestore(file.id)}
                            disabled={isRestoring}
                            className="p-2 rounded-lg hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                            title="Restore"
                            aria-label="Restore"
                          >
                            {isRestoring ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        {file.status === "deleted" && canHardDeleteThisFile && (
                          <button
                            onClick={() => setConfirmHardDeleteId(file.id)}
                            className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                            title="Hard Delete"
                            aria-label="Permanently delete file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {file.status !== "deleted" && (
                          <button
                            onClick={() => setConfirmDeleteId(file.id)}
                            className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                            title="Delete"
                            aria-label="Delete file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {playingVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPlayingVideoUrl(null)}
        >
          <div
            className="relative max-w-4xl w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPlayingVideoUrl(null)}
              className="absolute -top-10 right-0 p-2 text-white hover:text-slate-300"
              aria-label="Close video"
            >
              <X className="w-6 h-6" />
            </button>
            <video
              src={playingVideoUrl}
              controls
              autoPlay
              className="w-full rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}