'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import { useWorkspaceImages, useCreateWorkspaceImage, useDeleteWorkspaceImage, useCreateWorkspaceExport, useWorkspaceExports } from '@/lib/queries/convex/use-workspaces';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Upload, Trash2, Image as ImageIcon, X, ZoomIn, Download, FileArchive } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';

interface Image {
  _id: Id<'workspaceImages'>;
  workspaceId: Id<'workspaces'>;
  imageUrl: string;
  storageId?: string;
  createdBy: string;
  deletedAt?: number;
}

const IMAGE_CAPS = {
  mentee: 75,
  mentor: 150,
} as const;

interface WorkspaceImagesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role: 'mentee' | 'mentor';
}

export default function WorkspaceImages({ workspaceId, currentUserId, role }: WorkspaceImagesProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const { data: images, isLoading } = useWorkspaceImages(workspaceId);
  const { data: exports } = useWorkspaceExports(workspaceId);
  const createImage = useCreateWorkspaceImage();
  const deleteImage = useDeleteWorkspaceImage();
  const createExport = useCreateWorkspaceExport();

  const currentCount = images?.filter((img: Image) => !img.deletedAt).length || 0;
  const maxImages = role === 'mentee' ? IMAGE_CAPS.mentee : IMAGE_CAPS.mentor;
  const remainingImages = maxImages - currentCount;

  const latestExport = exports?.[0];
  const isProcessing = latestExport?.status === 'processing';
  const isPending = latestExport?.status === 'pending';

  useEffect(() => {
    if (latestExport?.status === 'completed' && latestExport.downloadUrl) {
      setDownloadUrl(latestExport.downloadUrl);
    }
  }, [latestExport]);

  const handleExport = async () => {
    setDownloadUrl(null);
    try {
      await createExport.mutateAsync({
        workspaceId,
        userId: currentUserId,
        format: 'zip',
      });
    } catch (error) {
      toast.error('Failed to create export. Please try again.');
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !workspaceId) return;

    if (!file.type.startsWith('image/')) {
      return;
    }

    if (remainingImages <= 0) {
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      try {
        await createImage.mutateAsync({
          workspaceId,
          imageUrl: dataUrl,
          createdBy: currentUserId,
        });
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  }, [workspaceId, currentUserId, createImage, remainingImages]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    maxFiles: 1,
    disabled: remainingImages <= 0 || isUploading,
  });

  const handleDeleteImage = async (imageId: Id<'workspaceImages'>) => {
    try {
      await deleteImage.mutateAsync({ id: imageId });
      setSelectedImage(null);
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
  };

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
            {currentCount} / {maxImages} images used ({remainingImages} remaining)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <Button variant="default" asChild>
              <a href={downloadUrl} download>
                <Download className="h-4 w-4 mr-2" />
                Download All
              </a>
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isProcessing || isPending || createExport.isPending}
            >
              {isProcessing || isPending || createExport.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileArchive className="h-4 w-4 mr-2" />
              )}
              {isProcessing ? 'Preparing...' : 'Download All'}
            </Button>
          )}
          <div {...getRootProps()}>
            <input {...getInputProps()} />
            <Button 
              disabled={remainingImages <= 0 || isUploading}
              variant={isDragActive ? "default" : "outline"}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Upload Image
            </Button>
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      {isDragActive && (
        <div className="mb-4 p-8 border-2 border-dashed border-primary rounded-lg bg-primary/5 text-center">
          <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
          <p>Drop image here to upload</p>
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
