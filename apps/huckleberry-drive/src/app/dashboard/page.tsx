"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { FileList } from "@/components/file-list";
import { StorageUsage } from "@/components/storage-usage";
import { listFilesWithParams, getStorageUsage } from "@/lib/api";
import type { FileItem, StorageUsage as StorageUsageType, FileListResponse } from "@/lib/api";
import { Loader2, Search } from "lucide-react";

type UserRole = "student" | "instructor" | "admin" | "video_editor";

export default function DashboardPage(): React.ReactElement {
  const { user, isLoaded } = useUser();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploadedByMeFiles, setUploadedByMeFiles] = useState<FileItem[]>([]);
  const [storageUsage, setStorageUsage] = useState<StorageUsageType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

const [uploadedByMeSearchQuery, setUploadedByMeSearchQuery] = useState("");
  const [uploadedByMeDebouncedSearch, setUploadedByMeDebouncedSearch] = useState("");
  const [uploadedByMeCursor, setUploadedByMeCursor] = useState<number | null>(null);
  const [uploadedByMeHasMore, setUploadedByMeHasMore] = useState(false);
  const [isLoadingUploadedByMeMore, setIsLoadingUploadedByMeMore] = useState(false);
  const userRole = (user?.publicMetadata?.role as UserRole) || null;
  const userId = user?.id || null;
  const instructorIds = useMemo(
    () => ((user?.publicMetadata?.instructorIds as string[] | undefined) ?? []),
    [user?.publicMetadata?.instructorIds]
  );
  const primaryInstructorId = useMemo(
    () => instructorIds[0] ?? null,
    [instructorIds]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

useEffect(() => {
    const timer = setTimeout(() => {
      setUploadedByMeDebouncedSearch(uploadedByMeSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [uploadedByMeSearchQuery]);
  const fetchInstructorFiles = useCallback(
    async (search?: string, nextCursor?: number | null, append = false, instructorId?: string) => {
      try {
        if (!append) setIsLoading(true);
        else setIsLoadingMore(true);
        setError(null);

        const result: FileListResponse = await listFilesWithParams({
          search: search || debouncedSearch || undefined,
          cursor: nextCursor ?? undefined,
          limit: 50,
          instructorId,
        });

        if (append) {
          setFiles((prev) => [...prev, ...result.files]);
        } else {
          setFiles(result.files);
        }
        setCursor(result.pagination.cursor);
        setHasMore(result.pagination.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load files");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [debouncedSearch]
  );

const fetchVideoEditorUploads = useCallback(
    async (search?: string, nextCursor?: number | null, append = false) => {
      if (!userId) return;
      try {
        if (!append) setIsLoading(true);
        else setIsLoadingUploadedByMeMore(true);

        const result: FileListResponse = await listFilesWithParams({
          uploadedById: userId,
          status: "completed",
          search: search || uploadedByMeDebouncedSearch || undefined,
          cursor: nextCursor ?? undefined,
          limit: 50,
        });

        if (append) {
          setUploadedByMeFiles((prev) => [...prev, ...result.files]);
        } else {
          setUploadedByMeFiles(result.files);
        }
        setUploadedByMeCursor(result.pagination.cursor);
        setUploadedByMeHasMore(result.pagination.hasMore);
      } catch (err) {
        console.error("Failed to fetch uploaded files:", err);
setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (!append) setIsLoading(false);
        else setIsLoadingUploadedByMeMore(false);
      }
    },
    [userId, uploadedByMeDebouncedSearch]
  );

  const fetchData = useCallback(async () => {
    try {
      if (userRole !== "video_editor") {
        setIsLoading(true);
      }
      setError(null);

      const [usageData] = await Promise.all([getStorageUsage()]);

      setStorageUsage(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      if (userRole !== "video_editor") {
        setIsLoading(false);
      }
    }
  }, [userRole]);

  useEffect(() => {
    if (isLoaded && user) {
      fetchData();
      if (userRole === "instructor" || userRole === "admin") {
        fetchInstructorFiles();
      } else if (userRole === "video_editor") {
        fetchVideoEditorUploads();
        if (primaryInstructorId) {
          fetchInstructorFiles(undefined, undefined, false, primaryInstructorId);
        }
      }
    }
  }, [isLoaded, user, userRole, fetchData, fetchInstructorFiles, fetchVideoEditorUploads, primaryInstructorId]);

  useEffect(() => {
    if (userRole === "instructor" || userRole === "admin") {
      fetchInstructorFiles(debouncedSearch, undefined, false);
    }
  }, [debouncedSearch, userRole, fetchInstructorFiles]);

useEffect(() => {
    if (userRole === "video_editor") {
      fetchVideoEditorUploads(uploadedByMeDebouncedSearch, undefined, false);
    }
}, [uploadedByMeDebouncedSearch, userRole, fetchVideoEditorUploads]);
  const handleLoadMore = useCallback(() => {
    if (cursor !== null) {
      fetchInstructorFiles(debouncedSearch, cursor, true);
    }
  }, [cursor, debouncedSearch, fetchInstructorFiles]);

const handleLoadMoreUploadedByMe = useCallback(() => {
    if (uploadedByMeCursor !== null) {
      fetchVideoEditorUploads(uploadedByMeDebouncedSearch, uploadedByMeCursor, true);
    }
  }, [uploadedByMeCursor, uploadedByMeDebouncedSearch, fetchVideoEditorUploads]);
  const handleFilesChange = useCallback(() => {
    if (userRole === "video_editor") {
      fetchVideoEditorUploads();
      if (instructorIds.length > 0) {
        fetchInstructorFiles(debouncedSearch, undefined, false, instructorIds[0]);
      }
    } else {
      fetchInstructorFiles(debouncedSearch, undefined, false);
    }
  }, [userRole, debouncedSearch, fetchInstructorFiles, fetchVideoEditorUploads, instructorIds]);

  if (!isLoaded || isLoading) {
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
          onClick={() => {
            fetchData();
            handleFilesChange();
          }}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const renderInstructorView = () => (
    <>
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
            aria-label="Search files"
          />
        </div>
      </div>

      <FileList
        files={files}
        onFilesChange={handleFilesChange}
        userRole={userRole || undefined}
        userId={userId || undefined}
      />

      {hasMore && (
        <div className="flex justify-center mt-4">
          <button
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
          >
            {isLoadingMore ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </span>
            ) : (
              "Load More"
            )}
          </button>
        </div>
      )}
    </>
  );

  const renderVideoEditorView = () => (
    <div className="space-y-8">
      {instructorIds.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-4">Instructor&apos;s Files</h2>
          <p className="text-sm text-slate-400 mb-4">
            Viewing files for {instructorIds.length} assigned instructor{instructorIds.length > 1 ? "s" : ""}
          </p>
          <FileList
            files={files}
            onFilesChange={handleFilesChange}
            userRole={userRole || undefined}
            userId={userId || undefined}
          />
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  "Load More"
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-4">Files I Uploaded</h2>
<div className="relative flex-1 max-w-md mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search files I uploaded..."
            value={uploadedByMeSearchQuery}
            onChange={(e) => setUploadedByMeSearchQuery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500"
aria-label="Search files I uploaded"
          />
        </div>
        <FileList
          files={uploadedByMeFiles}
          onFilesChange={handleFilesChange}
          userRole={userRole || undefined}
          userId={userId || undefined}
        />
{uploadedByMeHasMore && (
          <div className="flex justify-center mt-4">
            <button
              onClick={handleLoadMoreUploadedByMe}
              disabled={isLoadingUploadedByMeMore}
              className="px-6 py-3 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
            >
              {isLoadingUploadedByMeMore ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </span>
              ) : (
                "Load More"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );

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

      {userRole === "video_editor" ? renderVideoEditorView() : renderInstructorView()}
    </div>
  );
}