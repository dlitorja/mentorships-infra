"use client";

import React, { useState, useEffect, useCallback } from "react";
import { FileList } from "@/components/file-list";
import { StorageUsage } from "@/components/storage-usage";
import { listFiles, getStorageUsage } from "@/lib/api";
import type { FileItem, StorageUsage as StorageUsageType } from "@/lib/api";

export default function DashboardPage(): React.ReactElement {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsageType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [filesData, usageData] = await Promise.all([
        listFiles(),
        getStorageUsage(),
      ]);

      setFiles(filesData);
      setStorageUsage(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto" />
          <p className="mt-4 text-slate-400">Loading your files...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <p className="text-red-400">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Dashboard</h1>
        <p className="text-slate-400 mt-1">Manage your uploaded files</p>
      </div>

      {storageUsage && (
        <StorageUsage
          usedBytes={storageUsage.usedBytes}
          limitBytes={storageUsage.limitBytes}
          fileCount={storageUsage.fileCount}
        />
      )}

      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-4">Your Files</h2>
        <FileList files={files} onFilesChange={fetchData} />
      </div>
    </div>
  );
}