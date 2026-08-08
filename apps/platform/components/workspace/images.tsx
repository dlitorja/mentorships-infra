'use client';

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import type { UserRole } from '@/lib/auth-helpers';
import { useWorkspaceImagesPaginated, useWorkspace, useCreateWorkspaceImage, useDeleteWorkspaceImage, useCreateWorkspaceExport, useCancelWorkspaceExport, useWorkspaceExports, type WorkspaceImage } from '@/lib/queries/convex/use-workspaces';
import { useConvexAction } from '@convex-dev/react-query';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, Trash2, Image as ImageIcon, X, Download, AlertCircle, RefreshCw, ClipboardPaste } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { validateImageFiles, createImagePreviews, uploadSingleImage, type UploadError } from '@/lib/workspace-image-upload';
import { WORKSPACE_IMAGE_CAPS, PER_UPLOAD_CAP } from '@/lib/workspace-constants';



interface FailedUpload {
  file: File;
  preview: string;
  error: string;
}

interface WorkspaceImagesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role: UserRole;
  // PR #4b: id of the active video-call session, or null when no
  // call is active. While a call is active, uploads (including
  // clipboard paste) are tagged to this session via the
  // `useCreateWorkspaceImage` mutation.
  activeSessionId: Id<'sessions'> | null;
}

/**
 * Workspace tab for uploading, managing, and exporting images tied to a workspace.
 * Supports drag-and-drop, clipboard paste during calls, and ZIP export.
 */
export default function WorkspaceImages({ workspaceId, currentUserId, role, activeSessionId }: WorkspaceImagesProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasShownExportCompleteToast, setHasShownExportCompleteToast] = useState(false);
  const [lastExportAttemptId, setLastExportAttemptId] = useState<Id<'workspaceExports'> | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<Id<'workspaceImages'>>>(new Set());
  const [uploadedByFilter, setUploadedByFilter] = useState<'all' | 'me' | 'instructor' | 'student'>('all');
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  useEffect(() => {
    setSelectedImageIds(new Set());
  }, [uploadedByFilter]);

  const imagesQuery = useWorkspaceImagesPaginated(workspaceId, uploadedByFilter);
  const images = imagesQuery.results;
  const imagesStatus = imagesQuery.status;
  const canLoadMoreImages =
    imagesStatus === 'CanLoadMore' || imagesStatus === 'LoadingMore';
  const isLoadingMoreImages = imagesStatus === 'LoadingMore';
  const { data: workspace, isLoading: isLoadingWorkspace } = useWorkspace(workspaceId);
  const { data: exports, refetch: refetchExports } = useWorkspaceExports(workspaceId);
  const createImage = useCreateWorkspaceImage();
  const deleteImage = useDeleteWorkspaceImage();
  const createExport = useCreateWorkspaceExport();
  const cancelExport = useCancelWorkspaceExport();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const isAdmin = role === 'admin';
  const currentCount = isAdmin
    ? 0
    : (role === 'student'
      ? (workspace?.studentImageCount ?? 0)
      : (workspace?.instructorImageCount ?? 0));
  const maxImages = isAdmin
    ? WORKSPACE_IMAGE_CAPS.admin
    : (role === 'student' ? WORKSPACE_IMAGE_CAPS.student : WORKSPACE_IMAGE_CAPS.instructor);
  const remainingSlots = maxImages - currentCount;

  const latestExport = exports?.[0];
  const isProcessing = latestExport?.status === 'processing';
  const isPending = latestExport?.status === 'pending';

  useEffect(() => {
    if (latestExport?._id === lastExportAttemptId && latestExport.status === 'completed' && latestExport.downloadUrl) {
      setDownloadUrl(latestExport.downloadUrl);
      if (!hasShownExportCompleteToast) {
        toast.success('Your export is ready! Click to download.');
        setHasShownExportCompleteToast(true);
      }
    }
  }, [latestExport, hasShownExportCompleteToast, lastExportAttemptId]);

  const handleExport = async (imageIds?: Id<'workspaceImages'>[]): Promise<void> => {
    if (createExport.isPending || isPending || isProcessing) return;
    setLastExportAttemptId(null);
    setDownloadUrl(null);
    setHasShownExportCompleteToast(false);
    const exportPromise = createExport.mutateAsync({
      workspaceId,
      userId: currentUserId,
      format: 'zip',
      imageIds,
    });

    toast.promise(exportPromise, {
      loading: 'Creating export...',
      success: () => {
        return 'Export started!';
      },
      error: 'Failed to create export. Please try again.',
    });

    try {
      setLastExportAttemptId(await exportPromise);
    } catch {
      setLastExportAttemptId(null);
    }
  };

  const processFiles = useCallback(async (files: File[]): Promise<void> => {
    if (isLoadingWorkspace) {
      for (const file of files) {
        toast.error(`${file.name}: Workspace image count is still loading.`);
      }
      return;
    }
    const availableSlots = isAdmin ? 9999 : remainingSlots - imageFiles.length;
    const { valid, invalid } = validateImageFiles(files, availableSlots, isAdmin);

    for (const { file, error } of invalid) {
      toast.error(`${file.name}: ${error}`);
    }

    if (valid.length === 0) return;

    const previews = await createImagePreviews(valid);
    setPreviewImages((prev) => [...prev, ...previews]);
    setImageFiles((prev) => [...prev, ...valid]);
  }, [remainingSlots, isAdmin, imageFiles.length, isLoadingWorkspace]);

  const onDrop = useCallback(async (acceptedFiles: File[]): Promise<void> => {
    await processFiles(acceptedFiles);
  }, [processFiles]);

  const handleSendImages = async (): Promise<void> => {
    if (imageFiles.length === 0 || !workspaceId) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: imageFiles.length });

    const newFailedUploads: FailedUpload[] = [];
    const previewImagesCopy = [...previewImages];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const previewIndex = i;
      setUploadProgress({ current: i + 1, total: imageFiles.length });

      const result = await uploadSingleImage(
        workspaceId,
        file,
        generateUploadUrl,
        (args) =>
          createImage.mutateAsync({
            workspaceId: args.workspaceId,
            storageId: args.storageId,
            imageUrl: args.imageUrl,
            // PR #4b: tag uploads to the active call when present.
            sessionId: activeSessionId ?? undefined,
          })
      );

      if (!result.success) {
        newFailedUploads.push({
          file,
          preview: previewImagesCopy[previewIndex],
          error: (result as UploadError).error,
        });
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    if (newFailedUploads.length > 0) {
      setFailedUploads(newFailedUploads);
      setPreviewImages(newFailedUploads.map(f => f.preview));
      setImageFiles(newFailedUploads.map(f => f.file));
      toast.error(`${newFailedUploads.length} of ${imageFiles.length} images failed to upload. Tap to retry.`);
    } else {
      setPreviewImages([]);
      setImageFiles([]);
      setFailedUploads([]);
      toast.success(`${imageFiles.length} images uploaded successfully`);
    }
  };

  const handleRetryUpload = async (failedUpload: FailedUpload, index: number): Promise<void> => {
    const result = await uploadSingleImage(
      workspaceId,
      failedUpload.file,
      generateUploadUrl,
      (args) =>
        createImage.mutateAsync({
          workspaceId: args.workspaceId,
          storageId: args.storageId,
          imageUrl: args.imageUrl,
          sessionId: activeSessionId ?? undefined,
        })
    );

    if (result.success) {
      setFailedUploads((prev) => prev.filter((_, i) => i !== index));
      setPreviewImages((prev) => prev.filter((_, i) => i !== index));
      setImageFiles((prev) => prev.filter((_, i) => i !== index));
      toast.success('Image uploaded successfully');
    } else {
      setFailedUploads((prev) =>
        prev.map((f, i) => (i === index ? { ...f, error: result.error } : f))
      );
    }
  };

  const handleRetryAll = async (): Promise<void> => {
    const failed = [...failedUploads];
    setFailedUploads([]);
    setIsUploading(true);
    setUploadProgress({ current: 0, total: failed.length });
    const stillFailed: FailedUpload[] = [];

    for (let i = 0; i < failed.length; i++) {
      setUploadProgress({ current: i + 1, total: failed.length });
      const result = await uploadSingleImage(
        workspaceId,
        failed[i].file,
        generateUploadUrl,
        (args) =>
          createImage.mutateAsync({
            workspaceId: args.workspaceId,
            storageId: args.storageId,
            imageUrl: args.imageUrl,
            sessionId: activeSessionId ?? undefined,
          })
      );

      if (!result.success) {
        stillFailed.push({ ...failed[i], error: (result as UploadError).error });
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    if (stillFailed.length > 0) {
      setFailedUploads(stillFailed);
      setPreviewImages(stillFailed.map(f => f.preview));
      setImageFiles(stillFailed.map(f => f.file));
      toast.error(`${stillFailed.length} image${stillFailed.length !== 1 ? 's' : ''} still failed to upload`);
    } else {
      setFailedUploads([]);
      setPreviewImages([]);
      setImageFiles([]);
      toast.success('All images uploaded successfully');
    }
  };

  // PR #4b: clipboard-image paste while a call is active. We listen
  // at the window level while the Images tab is mounted, so a paste
  // anywhere on the page (dropzone, focused input, anywhere)
  // routes the image to `uploadSingleImage` tagged to the active
  // session. Gated on `activeSessionId` per the plan: the
  // "Paste from clipboard" affordance only appears during a call.
  useEffect(() => {
    if (!activeSessionId) return;
    if (isLoadingWorkspace) return;
    if (remainingSlots <= 0) return;

    const onPaste = async (e: ClipboardEvent) => {
      // Don't intercept if the user is pasting text into another input.
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
      }

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();

      const result = await uploadSingleImage(
        workspaceId,
        file,
        generateUploadUrl,
        (args) =>
          createImage.mutateAsync({
            workspaceId: args.workspaceId,
            storageId: args.storageId,
            imageUrl: args.imageUrl,
            sessionId: activeSessionId,
          })
      );

      if (!result.success) {
        toast.error((result as UploadError).error || "Upload failed");
        return;
      }
      toast.success("Clipboard image saved to this call");
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeSessionId, workspaceId, generateUploadUrl, createImage, remainingSlots, isLoadingWorkspace]);

  const removeImage = (index: number) => {
    setPreviewImages((prev) => prev.filter((_, i) => i !== index));
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setFailedUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    disabled: isLoadingWorkspace || remainingSlots <= 0 || isUploading,
    noClick: true,
    noKeyboard: true,
  });

  if (imagesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeImages = images || [];
    const selectedCount = selectedImageIds.size;
    const isSelectionMode = selectedCount > 0;
    const selectedDeletableCount = activeImages.reduce((count, img) => {
    if (selectedImageIds.has(img._id) && (role === 'admin' || role === 'instructor' || img.createdBy === currentUserId)) {
      return count + 1;
    }
    return count;
  }, 0);

  const toggleImageSelection = (imageId: Id<'workspaceImages'>) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const selectLoadedImages = () => {
    setSelectedImageIds(new Set(activeImages.map((img) => img._id)));
  };

  const clearSelection = () => {
    setSelectedImageIds(new Set());
  };

  const handleDeleteSelected = async (): Promise<void> => {
    if (isDeletingSelected) return;
    const selected = [...selectedImageIds];
    if (selected.length === 0) return;

    const deletable = selected.filter((id) => {
      const img = activeImages.find((i) => i._id === id);
      if (!img) return false;
      return role === 'admin' || role === 'instructor' || img.createdBy === currentUserId;
    });

    if (deletable.length === 0) {
      toast.error('You do not have permission to delete the selected images.');
      return;
    }

    setIsDeletingSelected(true);
    const deletedIds: Id<'workspaceImages'>[] = [];
    const failedIds: Id<'workspaceImages'>[] = [];

    try {
      for (const id of deletable) {
        try {
          await deleteImage.mutateAsync({ id });
          deletedIds.push(id);
        } catch {
          failedIds.push(id);
        }
      }
    } finally {
      setIsDeletingSelected(false);
    }

    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      for (const id of deletedIds) {
        next.delete(id);
      }
      return next;
    });

    if (deletedIds.length > 0) {
      toast.success(
        `Deleted ${deletedIds.length} image${deletedIds.length === 1 ? '' : 's'}`
      );
    }

    if (failedIds.length > 0) {
      toast.error(
        `Failed to delete ${failedIds.length} image${failedIds.length === 1 ? '' : 's'}. Please try again.`
      );
    }

    if (deletable.length < selected.length) {
      toast.error(
        `${selected.length - deletable.length} selected image${selected.length - deletable.length === 1 ? ' could not be' : 's could not be'} deleted.`
      );
    }
  };

  const uploaderLabel = (img: WorkspaceImage): string => {
    if (img.createdBy === currentUserId) return 'You';
    if (img.uploaderRole === 'instructor') return 'Instructor';
    if (img.uploaderRole === 'student') return 'Student';
    return 'Other';
  };

  return (
    <div className="flex flex-col">
      {/* Header with upload */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Images</h3>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={async () => {
              setIsRefreshing(true);
              const toastId = toast.loading('Refreshing exports...');
              try {
                const exportsResult = await refetchExports();
                setIsRefreshing(false);
                if (exportsResult?.isError) {
                  toast.error('Failed to refresh', { id: toastId });
                } else {
                  toast.success('Exports refreshed', { id: toastId });
                }
              } catch {
                setIsRefreshing(false);
                toast.error('Failed to refresh', { id: toastId });
              }
            }}
            title="Refresh exports"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {isLoadingWorkspace
            ? 'Loading image count...'
            : `${currentCount} / ${maxImages} images used (${remainingSlots} remaining)`}
        </p>
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <Button variant="default" asChild>
              <a href={downloadUrl} download>
                <Download className="h-4 w-4 mr-2" />
                Download ZIP
              </a>
            </Button>
          ) : isProcessing ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary">Creating zip...</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => latestExport && cancelExport.mutateAsync({ id: latestExport._id })}
                  disabled={cancelExport.isPending}
                >
                  {cancelExport.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">You can leave this page and return later</span>
            </div>
          ) : isPending ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Export queued...</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => latestExport && cancelExport.mutateAsync({ id: latestExport._id })}
                  disabled={cancelExport.isPending}
                >
                  {cancelExport.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">You can leave this page and return later</span>
            </div>
          ) : latestExport?.status === 'failed' && latestExport._id === lastExportAttemptId ? (
            <>
              <div className="flex flex-col items-end gap-1">
                <p className="text-sm text-destructive">Export failed</p>
                {latestExport.errorMessage && (
                  <p className="text-xs text-muted-foreground max-w-xs truncate" title={latestExport.errorMessage}>
                    {latestExport.errorMessage}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={() => handleExport()} disabled={createExport.isPending}>
                {createExport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Retry image export
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleExport()} disabled={createExport.isPending}>
                {createExport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Export ZIP
              </Button>
            </>
          )}
           </div>
      </div>

      {/* Filter + selection controls */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <Checkbox
              id="select-all-images"
              checked={
                selectedCount === 0
                  ? false
                  : selectedCount === activeImages.length
                    ? true
                    : 'indeterminate'
              }
              onCheckedChange={(checked) => {
                if (checked === true) {
                  selectLoadedImages();
                } else {
                  clearSelection();
                }
              }}
              aria-label="Select loaded images"
            />
            <span className="select-none">Select loaded</span>
          </label>
          <Select
            value={uploadedByFilter}
            onValueChange={(value) => {
              const validFilters: ('all' | 'me' | 'instructor' | 'student')[] = ['all', 'me', 'instructor', 'student'];
              if (validFilters.includes(value as 'all' | 'me' | 'instructor' | 'student')) {
                setUploadedByFilter(value as 'all' | 'me' | 'instructor' | 'student');
              }
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Filter by uploader">
              <SelectValue placeholder="Filter by uploader" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All uploaders</SelectItem>
              <SelectItem value="me">Me</SelectItem>
              <SelectItem value="instructor">Instructor</SelectItem>
              <SelectItem value="student">Student</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selectedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {selectedCount} selected
          </span>
        )}
      </div>

      {/* Drop Area */}
      <div
        {...getRootProps()}
        className={clsx(
          "mb-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          isDragActive ? "border-primary bg-primary/10" : "border-muted-foreground/25 bg-muted/30",
          isLoadingWorkspace || remainingSlots <= 0 || isUploading ? "cursor-not-allowed opacity-60" : "cursor-default hover:border-primary/60 hover:bg-muted/50"
        )}
      >
        <input {...getInputProps()} />
        <Upload className={clsx("mx-auto mb-2 h-8 w-8", isDragActive ? "text-primary" : "text-muted-foreground")} />
        <p className="text-sm font-medium">
          {isDragActive ? "Drop images here" : "Drag and drop images here"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PNG, JPG, GIF, or WebP up to 5MB. You can add up to {PER_UPLOAD_CAP} images at a time.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isLoadingWorkspace || remainingSlots <= 0 || isUploading}
            onClick={open}
          >
            Browse files
          </Button>
          {/* PR #4b: clipboard paste hint + button while a call is active. */}
          {activeSessionId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={isLoadingWorkspace || remainingSlots <= 0 || isUploading}
              onClick={() => {
                // Focus the dropzone area so subsequent ⌘/Ctrl+V
                // paste events target this component (the global
                // listener installed in the effect above still
                // catches them, but focusing helps user understanding).
                document.body.focus();
                toast.info("Press ⌘/Ctrl + V to paste an image from your clipboard");
              }}
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste from clipboard
            </Button>
          )}
        </div>
      </div>

      {/* Upload Progress */}
      {isUploading && uploadProgress && (
        <div className="mb-4 p-4 border rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">
              Uploading: {uploadProgress.current} of {uploadProgress.total} images
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Image Previews */}
      {previewImages.length > 0 && !isUploading && (
        <div className="mb-4 p-4 border rounded-lg bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {failedUploads.length > 0 ? `${failedUploads.length} failed` : `${previewImages.length} image${previewImages.length !== 1 ? 's' : ''} ready to upload`}
            </span>
            {failedUploads.length > 1 && (
              <Button size="sm" variant="outline" onClick={handleRetryAll}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry All
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {previewImages.map((preview, index) => {
              const failed = failedUploads.find((_, i) => i === index);
              return (
                <div key={index} className="relative group">
                  <Image
                    src={preview}
                    alt={`Preview ${index + 1}`}
                    width={80}
                    height={80}
                    unoptimized
                    className={clsx(
                      "h-20 w-20 object-cover rounded-md border",
                      failed ? "border-red-500" : "border-muted"
                    )}
                  />
                  {failed ? (
                    <>
                      <div className="absolute inset-0 bg-black/50 rounded-md flex items-center justify-center">
                        <AlertCircle className="h-6 w-6 text-red-500" />
                      </div>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="h-6 w-6 absolute -top-2 -right-2"
                        onClick={() => handleRetryUpload(failed, index)}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-6 w-6 absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSendImages} disabled={isUploading}>
              <Upload className="h-4 w-4 mr-1" />
              Upload {previewImages.length} Image{previewImages.length !== 1 ? 's' : ''}
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              setPreviewImages([]);
              setImageFiles([]);
              setFailedUploads([]);
            }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Image Grid */}
      <div className="relative">
        {isRefreshing && (
          <div className="absolute inset-0 bg-background/80 z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Refreshing exports...</span>
            </div>
          </div>
        )}
        {activeImages.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {activeImages.map((img: WorkspaceImage) => {
              const isSelected = selectedImageIds.has(img._id);
              return (
                <div
                  key={img._id}
                  className={clsx(
                    "group relative aspect-square rounded-lg overflow-hidden border bg-muted",
                    isSelected && "ring-2 ring-primary"
                  )}
                >
                  <button
                    type="button"
                    className="block h-full w-full cursor-pointer border-0 bg-transparent p-0"
                    onClick={() => {
                      if (isSelectionMode) {
                        toggleImageSelection(img._id);
                      } else {
                        setSelectedImage(img.imageUrl);
                      }
                    }}
                    aria-label={isSelectionMode ? `Toggle selection for image uploaded by ${uploaderLabel(img)}` : "Open workspace image preview"}
                  >
                    <Image
                      src={img.imageUrl}
                      alt="Workspace image"
                      fill
                      unoptimized
                      loading="lazy"
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover"
                    />
                  </button>
                  <div className="absolute top-2 left-2 z-10 rounded bg-white/90 p-1 shadow">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleImageSelection(img._id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select image uploaded by ${uploaderLabel(img)}`}
                    />
                  </div>
                  <div className="absolute top-2 right-2 z-10">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                      {uploaderLabel(img)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No images yet</p>
              <p className="text-sm">Drag and drop images here or click upload</p>
            </div>
          </div>
        )}

        {selectedCount > 0 && (
          <div className="sticky bottom-4 z-30 mt-4 flex justify-center">
            <div className="flex items-center gap-3 rounded-lg border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
              <span className="text-sm font-medium">
                {selectedCount} selected
                {selectedDeletableCount < selectedCount && (
                  <span className="text-muted-foreground text-xs ml-1">
                    ({selectedDeletableCount} deletable)
                  </span>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={clearSelection}
              >
                Clear
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleExport([...selectedImageIds])}
                disabled={createExport.isPending || isPending || isProcessing}
              >
                {createExport.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Export selected
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={selectedDeletableCount === 0 || isDeletingSelected}
              >
                {isDeletingSelected && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <Trash2 className="h-4 w-4 mr-2" />
                Delete selected
              </Button>
            </div>
          </div>
        )}
      </div>

      {canLoadMoreImages && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => imagesQuery.loadMore(24)}
            disabled={isLoadingMoreImages}
          >
            {isLoadingMoreImages && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Load more images
          </Button>
        </div>
      )}

      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedImage(null);
            }}
          >
            <X className="h-6 w-6" />
          </Button>
          <div
            className="relative w-full h-full max-w-full max-h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={selectedImage}
              alt="Full size"
              fill
              unoptimized
              sizes="100vw"
              className="object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
