'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import { useWorkspaceMessages, useCreateWorkspaceMessage, useCreateWorkspaceImageAndMessage, useWorkspaceImages } from '@/lib/queries/convex/use-workspaces';
import { useConvexAction } from '@convex-dev/react-query';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Send, Image as ImageIcon, X, Upload, AlertCircle, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { validateImageFiles, createImagePreviews, uploadImageForChat, type UploadError } from '@/lib/workspace-image-upload';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PER_UPLOAD_CAP = 5;

interface Message {
  _id: Id<'workspaceMessages'>;
  workspaceId: Id<'workspaces'>;
  userId: string;
  content: string;
  type: 'text' | 'image' | 'file';
}

interface FailedUpload {
  file: File;
  preview: string;
  error: string;
}

interface WorkspaceChatProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role?: 'student' | 'instructor' | 'admin';
}

export default function WorkspaceChat({ workspaceId, currentUserId, role = 'student' }: WorkspaceChatProps) {
  const [message, setMessage] = useState('');
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: messages, isLoading } = useWorkspaceMessages(workspaceId);
  const { data: existingImages } = useWorkspaceImages(workspaceId);
  const createMessage = useCreateWorkspaceMessage();
  const createImageAndMessage = useCreateWorkspaceImageAndMessage();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const isAdmin = role === 'admin';
  const currentCount = existingImages?.filter((img: any) => !img.deletedAt).length || 0;
  const remainingSlots = isAdmin ? 999 : (role === 'instructor' ? 150 : 75) - currentCount;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!message.trim() || !workspaceId) return;

    try {
      await createMessage.mutateAsync({
        workspaceId,
        userId: currentUserId,
        content: message.trim(),
        type: 'text',
      });
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    noClick: true,
    noKeyboard: true,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !workspaceId) return;
    await processFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSendImages = async () => {
    if (imageFiles.length === 0 || !workspaceId) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress({ current: 0, total: imageFiles.length });

    const newFailedUploads: FailedUpload[] = [];
    const previewImagesCopy = [...previewImages];
    const imageFilesCopy = [...imageFiles];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const previewIndex = i;
      setUploadProgress({ current: i + 1, total: imageFiles.length });

      const uploadResult = await uploadImageForChat(workspaceId, file, generateUploadUrl);

      if (!uploadResult.success) {
        newFailedUploads.push({
          file,
          preview: previewImagesCopy[previewIndex],
          error: (uploadResult as UploadError).error,
        });
        continue;
      }

      try {
        await createImageAndMessage.mutateAsync({
          workspaceId,
          storageId: uploadResult.storageId,
        });
      } catch (err) {
        newFailedUploads.push({
          file,
          preview: previewImagesCopy[previewIndex],
          error: err instanceof Error ? err.message : 'Failed to create message',
        });
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    const successfulPreviews = imageFiles.length - newFailedUploads.length;
    if (newFailedUploads.length > 0) {
      setFailedUploads(newFailedUploads);
      setPreviewImages(newFailedUploads.map(f => f.preview));
      setImageFiles(newFailedUploads.map(f => f.file));
      toast.error(`${newFailedUploads.length} of ${imageFiles.length} images failed to upload. Tap to retry.`);
    } else {
      setPreviewImages([]);
      setImageFiles([]);
      toast.success(`${successfulPreviews} image${successfulPreviews !== 1 ? 's' : ''} sent`);
    }
  };

  const handleRetryUpload = async (failedUpload: FailedUpload, index: number) => {
    const uploadResult = await uploadImageForChat(workspaceId, failedUpload.file, generateUploadUrl);

    if (!uploadResult.success) {
      setFailedUploads((prev) =>
        prev.map((f, i) => (i === index ? { ...f, error: uploadResult.error } : f))
      );
      return;
    }

    try {
      await createImageAndMessage.mutateAsync({
        workspaceId,
        storageId: uploadResult.storageId,
      });
      setFailedUploads((prev) => prev.filter((_, i) => i !== index));
      setPreviewImages((prev) => prev.filter((_, i) => i !== index));
      setImageFiles((prev) => prev.filter((_, i) => i !== index));
      toast.success('Image uploaded successfully');
    } catch (err) {
      setFailedUploads((prev) =>
        prev.map((f, i) => (i === index ? { ...f, error: err instanceof Error ? err.message : 'Failed' } : f))
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
      const uploadResult = await uploadImageForChat(workspaceId, failed[i].file, generateUploadUrl);

      if (!uploadResult.success) {
        failed[i] = { ...failed[i], error: uploadResult.error };
        stillFailed.push(failed[i]);
        continue;
      }

      try {
        await createImageAndMessage.mutateAsync({
          workspaceId,
          storageId: uploadResult.storageId,
        });
      } catch (err) {
        failed[i] = { ...failed[i], error: err instanceof Error ? err.message : 'Failed' };
        stillFailed.push(failed[i]);
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    if (stillFailed.length > 0) {
      setFailedUploads(stillFailed);
      setPreviewImages(stillFailed.map(f => f.preview));
      setImageFiles(stillFailed.map(f => f.file));
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div {...getRootProps()} className={clsx(
      "h-full flex flex-col rounded-lg border-2 transition-colors",
      isDragActive ? "border-primary bg-primary/5" : "border-transparent"
    )}>
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-lg z-10">
          <div className="text-center">
            <Upload className="h-12 w-12 mx-auto mb-2 text-primary" />
            <p className="text-lg font-medium">Drop images here</p>
            <p className="text-sm text-muted-foreground">Release to attach</p>
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-3 p-2">
        {messages && messages.length > 0 ? (
          messages.map((msg: Message) => (
            <div
              key={msg._id}
              className={clsx(
                "flex",
                msg.userId === currentUserId ? "justify-end" : "justify-start"
              )}
            >
              <div className={clsx(
                "max-w-[80%] rounded-lg px-3 py-2",
                msg.userId === currentUserId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}>
                {msg.type === 'image' ? (
                  <img
                    src={msg.content}
                    alt="Shared image"
                    className="max-w-full rounded-md"
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                <p className={clsx(
                  "text-xs mt-1",
                  msg.userId === currentUserId
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                )}>
                  {msg.userId === currentUserId ? 'You' : msg.userId.slice(0, 8)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p>No messages yet</p>
              <p className="text-sm">Start the conversation!</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload Progress */}
      {isUploading && uploadProgress && (
        <div className="px-3 py-2 border-t bg-muted/50">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">
              Uploading: {uploadProgress.current} of {uploadProgress.total} images
            </span>
          </div>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Image Previews */}
      {(previewImages.length > 0 || failedUploads.length > 0) && !isUploading && (
        <div className="p-3 border-t bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {failedUploads.length > 0 ? `${failedUploads.length} failed` : `${previewImages.length} image${previewImages.length !== 1 ? 's' : ''} ready`}
            </span>
            {failedUploads.length > 1 && (
              <Button size="sm" variant="outline" onClick={handleRetryAll}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry All
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
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
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={handleSendImages} disabled={isUploading}>
              <Send className="h-4 w-4 mr-1" />
              Send {previewImages.length} Image{previewImages.length !== 1 ? 's' : ''}
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

      {/* Message Input */}
      <div className="p-3 border-t shrink-0">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
          </Button>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
          />
          <Button onClick={handleSendMessage} disabled={!message.trim() || createMessage.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Drag and drop images directly into the chat
        </p>
      </div>
    </div>
  );
}