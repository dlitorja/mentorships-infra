'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import { useWorkspaceImages, useCreateWorkspaceImage, useDeleteWorkspaceImage, useCreateWorkspaceExport, useWorkspaceExports } from '@/lib/queries/convex/use-workspaces';
import { useConvexAction } from '@convex-dev/react-query';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Upload, Trash2, Image as ImageIcon, X, ZoomIn, Download, FileArchive, FileText, AlertCircle, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { validateImageFiles, createImagePreviews, uploadSingleImage, type UploadError } from '@/lib/workspace-image-upload';

type ExportFormat = 'zip' | 'pdf' | 'markdown';

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
  student: 75,
  instructor: 150,
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>('zip');

  const { data: images, isLoading } = useWorkspaceImages(workspaceId);
  const { data: exports } = useWorkspaceExports(workspaceId);
  const createImage = useCreateWorkspaceImage();
  const deleteImage = useDeleteWorkspaceImage();
  const createExport = useCreateWorkspaceExport();
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
    }
  }, [latestExport]);

  useEffect(() => {
    setDownloadUrl(null);
  }, [exportFormat]);

  const handleExport = async () => {
    setDownloadUrl(null);
    try {
      await createExport.mutateAsync({
        workspaceId,
        userId: currentUserId,
        format: exportFormat,
      });
    } catch (error) {
      toast.error('Failed to create export. Please try again.');
    }
  };

  const formatLabel = exportFormat === 'pdf' ? 'PDF' : exportFormat === 'markdown' ? 'Markdown' : 'ZIP';
  const formatIcon = exportFormat === 'pdf' ? <FileText className="h-4 w-4" /> : exportFormat === 'markdown' ? <FileText className="h-4 w-4" /> : <FileArchive className="h-4 w-4" />;

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
    <div className="h-full flex flex-col">
      {/* Header with upload */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h3 className="font-semibold">Images</h3>
          <p className="text-sm text-muted-foreground">
            {currentCount} / {maxImages} images used ({remainingSlots} remaining)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <Button variant="default" asChild>
              <a href={downloadUrl} download>
                <Download className="h-4 w-4 mr-2" />
                Download {formatLabel}
              </a>
            </Button>
          ) : (
            <>
              <Select value={exportFormat} onValueChange={(v: ExportFormat) => setExportFormat(v)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zip">ZIP</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={isProcessing || isPending || createExport.isPending}
              >
                {isProcessing || isPending || createExport.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  formatIcon
                )}
                {isProcessing ? 'Preparing...' : `Export ${formatLabel}`}
              </Button>
            </>
          )}
          <Button
            disabled={remainingSlots <= 0 || isUploading}
            variant="outline"
            onClick={open}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {imageFiles.length > 0 ? `Add More (${imageFiles.length})` : 'Upload Images'}
          </Button>
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
      <div className="flex-1 overflow-y-auto">
        {activeImages.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {activeImages.map((img: Image) => (
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
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8"
                    onClick={() => setSelectedImage(img.imageUrl)}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  {img.createdBy === currentUserId && (
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-8 w-8"
                      onClick={() => handleDeleteImage(img._id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
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
