'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import { useWorkspaceImages, useCreateWorkspaceImage, useDeleteWorkspaceImage, useCreateWorkspaceExport, useCancelWorkspaceExport, useWorkspaceExports } from '@/lib/queries/convex/use-workspaces';
import { useConvexAction } from '@convex-dev/react-query';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Upload, Trash2, Image as ImageIcon, X, ZoomIn, Download, FileArchive, FileText, AlertCircle, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { validateImageFiles, createImagePreviews, uploadSingleImage, type UploadError } from '@/lib/workspace-image-upload';

interface Image {
  _id: Id<'workspaceImages'>;
  workspaceId: Id<'workspaces'>;
  imageUrl: string;
  storageId?: string;
  createdBy: string;
  deletedAt?: number;
}

interface FailedUpload {
  file: File;
  preview: string;
  error: string;
}

const IMAGE_CAPS = {
  student: 500,
  instructor: 500,
} as const;

const PER_UPLOAD_CAP = 5;

interface WorkspaceImagesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role: 'student' | 'instructor' | 'admin';
}

export default function WorkspaceImages({ workspaceId, currentUserId, role }: WorkspaceImagesProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasShownExportCompleteToast, setHasShownExportCompleteToast] = useState(false);
  const [lastExportAttemptAt, setLastExportAttemptAt] = useState<number>(0);

  const { data: images, isLoading, refetch: refetchImages } = useWorkspaceImages(workspaceId);
  const { data: exports, refetch: refetchExports } = useWorkspaceExports(workspaceId);
  const createImage = useCreateWorkspaceImage();
  const deleteImage = useDeleteWorkspaceImage();
  const createExport = useCreateWorkspaceExport();
  const cancelExport = useCancelWorkspaceExport();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const isAdmin = role === 'admin';
  const currentCount = images?.filter((img: Image) => !img.deletedAt).length || 0;
  const maxImages = isAdmin ? 9999 : (role === 'student' ? IMAGE_CAPS.student : IMAGE_CAPS.instructor);
  const remainingSlots = maxImages - currentCount;

  const latestExport = exports?.[0];
  const isProcessing = latestExport?.status === 'processing';
  const isPending = latestExport?.status === 'pending';

  useEffect(() => {
    if (latestExport?.status === 'completed' && latestExport.downloadUrl) {
      setDownloadUrl(latestExport.downloadUrl);
      if (!hasShownExportCompleteToast) {
        toast.success('Your export is ready! Click to download.');
        setHasShownExportCompleteToast(true);
      }
    }
  }, [latestExport, hasShownExportCompleteToast]);

  const handleExport = async () => {
    setLastExportAttemptAt(Date.now());
    setDownloadUrl(null);
    setHasShownExportCompleteToast(false);
    toast.promise(
      createExport.mutateAsync({
        workspaceId,
        userId: currentUserId,
        format: 'zip',
      }),
      {
        loading: 'Creating export...',
        success: () => {
          return 'Export started!';
        },
        error: 'Failed to create export. Please try again.',
      }
    );
  };

  const formatLabel = 'ZIP';

  const processFiles = useCallback(async (files: File[]) => {
    const availableSlots = isAdmin ? 9999 : remainingSlots - imageFiles.length;
    const { valid, invalid } = validateImageFiles(files, availableSlots, isAdmin);

    for (const { file, error } of invalid) {
      toast.error(`${file.name}: ${error}`);
    }

    if (valid.length === 0) return;

    const previews = await createImagePreviews(valid);
    setPreviewImages((prev) => [...prev, ...previews]);
    setImageFiles((prev) => [...prev, ...valid]);
  }, [remainingSlots, isAdmin, imageFiles.length]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    await processFiles(acceptedFiles);
  }, [processFiles]);

  const handleSendImages = async () => {
    if (imageFiles.length === 0 || !workspaceId) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: imageFiles.length });

    const newFailedUploads: FailedUpload[] = [];
    const previewImagesCopy = [...previewImages];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const previewIndex = i;
      setUploadProgress({ current: i + 1, total: imageFiles.length });

      const result = await uploadSingleImage(workspaceId, file, generateUploadUrl, createImage.mutateAsync);

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

  const handleRetryUpload = async (failedUpload: FailedUpload, index: number) => {
    const result = await uploadSingleImage(workspaceId, failedUpload.file, generateUploadUrl, createImage.mutateAsync);

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

  const handleRetryAll = async () => {
    const failed = [...failedUploads];
    setFailedUploads([]);
    setIsUploading(true);
    setUploadProgress({ current: 0, total: failed.length });
    const stillFailed: FailedUpload[] = [];

    for (let i = 0; i < failed.length; i++) {
      setUploadProgress({ current: i + 1, total: failed.length });
      const result = await uploadSingleImage(workspaceId, failed[i].file, generateUploadUrl, createImage.mutateAsync);

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

  const removeImage = (index: number) => {
    setPreviewImages((prev) => prev.filter((_, i) => i !== index));
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setFailedUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDeleteImage = async (imageId: Id<'workspaceImages'>) => {
    try {
      await deleteImage.mutateAsync({ id: imageId });
      setSelectedImage(null);
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    disabled: remainingSlots <= 0 || isUploading,
    noClick: true,
    noKeyboard: true,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeImages = images?.filter((img: Image) => !img.deletedAt) || [];

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
              const toastId = toast.loading('Refreshing images and exports...');
              try {
                const [imagesResult, exportsResult] = await Promise.all([refetchImages(), refetchExports()]);
                const hasError = imagesResult?.isError || exportsResult?.isError;
                setIsRefreshing(false);
                if (hasError) {
                  toast.error('Failed to refresh', { id: toastId });
                } else {
                  toast.success('Images and exports refreshed', { id: toastId });
                }
              } catch {
                setIsRefreshing(false);
                toast.error('Failed to refresh', { id: toastId });
              }
            }}
            title="Refresh images and exports"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {currentCount} / {maxImages} images used ({remainingSlots} remaining)
        </p>
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <Button variant="default" asChild>
              <a href={downloadUrl} download>
                <Download className="h-4 w-4 mr-2" />
                Download {formatLabel}
              </a>
            </Button>
          ) : isProcessing ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary">Creating {formatLabel.toLowerCase()}...</span>
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
          ) : latestExport?.status === 'failed' && latestExport._creationTime >= lastExportAttemptAt && lastExportAttemptAt > 0 ? (
            <>
              <p className="text-sm text-destructive">Export failed</p>
              <Button variant="outline" onClick={handleExport} disabled={createExport.isPending}>
                {createExport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Retry image export
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleExport} disabled={createExport.isPending}>
                {createExport.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Export ZIP
              </Button>
            </>
          )}
          </div>
      </div>

      {/* Drop Area */}
      <div
        {...getRootProps()}
        className={clsx(
          "mb-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          isDragActive ? "border-primary bg-primary/10" : "border-muted-foreground/25 bg-muted/30",
          remainingSlots <= 0 || isUploading ? "cursor-not-allowed opacity-60" : "cursor-default hover:border-primary/60 hover:bg-muted/50"
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
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3"
          disabled={remainingSlots <= 0 || isUploading}
          onClick={open}
        >
          Browse files
        </Button>
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
                  <img
                    src={preview}
                    alt={`Preview ${index + 1}`}
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
              <span className="text-sm text-muted-foreground">Refreshing images...</span>
            </div>
          </div>
        )}
        {activeImages.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {activeImages.map((img: Image) => {
              const canDelete = role === 'admin' || 
                (role === 'instructor' && img.createdBy !== currentUserId) || 
                img.createdBy === currentUserId;
              return (
                <div
                  key={img._id}
                  className="group relative aspect-square rounded-lg overflow-hidden border bg-muted"
                >
                  <img
                    src={img.imageUrl}
                    alt="Workspace image"
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setSelectedImage(img.imageUrl)}
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    {canDelete && (
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-8 w-8 pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(img._id); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
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
      </div>

      {/* Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white hover:bg-white/20"
            onClick={() => setSelectedImage(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          <img
            src={selectedImage}
            alt="Full size"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
