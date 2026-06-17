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
} from "lucide-react";
import { deleteFile, getDownloadUrl } from "@/lib/api";
import type { FileItem } from "@/lib/api";

interface FileListProps {
  files: FileItem[];
  onFilesChange: () => void;
}

export function FileList({
  files,
  onFilesChange,
}: FileListProps): React.ReactElement {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    setDownloadingId(file.id);
    try {
      const url = await getDownloadUrl(file.id);
      window.open(url, "_blank");
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setDownloadingId(null);
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
            const isDownloading = downloadingId === file.id;
            const isConfirming = confirmDeleteId === file.id;

            return (
              <tr key={file.id} className="hover:bg-slate-800/30 transition-colors">
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
                  <div className={`flex items-center gap-2 ${statusDisplay.color}`}>
                    {statusDisplay.icon}
                    <span className="text-sm">{statusDisplay.text}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {isConfirming ? (
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
                        <button
                          onClick={() => handleDownload(file)}
                          disabled={isDownloading}
                          className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                          title="Download"
                        >
                          {isDownloading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(file.id)}
                          className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}