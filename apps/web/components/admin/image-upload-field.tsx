"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";
import Image from "next/image";

const uploadResponseSchema = z.object({
  url: z.string(),
  path: z.string().optional(),
});

interface ImageUploadFieldProps {
  label?: string;
  value?: string;
  onChange: (url: string) => void;
  onCommit?: (url: string) => void;
  uploadEndpoint?: string;
  placeholder?: string;
  multiple?: boolean;
  maxFiles?: number;
  onMultipleUpload?: (urls: string[]) => void;
  onUploadComplete?: (url: string, path: string) => void;
  instructorId?: string;
  type?: "profile" | "portfolio" | "result";
  previewSize?: number;
  previewClassName?: string;
}

const ACCEPTED_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
};

/**
 * Unified image upload field for admin and instructor interfaces.
 *
 * Supports:
 * - URL input
 * - Drag-and-drop single or multiple file upload
 * - Instructor-specific uploads (instructorId + type)
 * - Path callback via onUploadComplete for instructor workflows
 *
 * @param label - Label text for the upload field
 * @param value - Current image URL value
 * @param onChange - Callback fired when image URL changes (also called on file uploads)
 * @param onCommit - Optional commit callback for URL input, triggered on blur/Enter instead of on every keystroke
 * @param uploadEndpoint - API endpoint for file upload
 * @param placeholder - Placeholder text for URL input
 * @param multiple - Allow multiple file uploads
 * @param maxFiles - Maximum number of files for multiple uploads
 * @param onMultipleUpload - Callback fired with array of URLs for multiple uploads
 * @param onUploadComplete - Callback fired with URL and storage path after upload
 * @param instructorId - Instructor ID required for the instructor admin upload route
 * @param type - Upload type for the instructor admin route: profile, portfolio, or result
 * @param previewSize - Width/height of the preview in pixels (default 128)
 * @param previewClassName - Additional classes for the preview container
 */
export function ImageUploadField({
  label,
  value,
  onChange,
  onCommit,
  uploadEndpoint: uploadEndpointProp,
  placeholder = "https://example.com/image.jpg",
  multiple = false,
  maxFiles = multiple ? 10 : 1,
  onMultipleUpload,
  onUploadComplete,
  instructorId,
  type = "profile",
  previewSize = 128,
  previewClassName,
}: ImageUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(value || "");
  const [previewFailed, setPreviewFailed] = useState(false);

  const uploadEndpoint = uploadEndpointProp ?? (instructorId ? "/api/admin/instructors/upload" : "/api/admin/upload");

  useEffect(() => {
    setUrlInput(value || "");
    setPreviewFailed(false);
  }, [value]);

  const uploadFile = useCallback(
    async (file: File): Promise<{ url: string; path?: string } | null> => {
      if (!instructorId && uploadEndpoint === "/api/admin/instructors/upload") {
        setUploadError("Instructor ID required for uploads");
        return null;
      }

      setIsUploading(true);
      setUploadError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);
        if (instructorId) {
          formData.append("instructorId", instructorId);
          formData.append("type", type);
        }

        const response = await fetch(uploadEndpoint, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Upload failed");
        }

        const data = uploadResponseSchema.parse(await response.json());
        return { url: data.url, path: data.path };
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [instructorId, type, uploadEndpoint]
  );

  const finalizeUpload = useCallback(
    (url: string, path?: string) => {
      onChange(url);
      setUrlInput(onCommit ? "" : url);
      if (onUploadComplete && path) {
        onUploadComplete(url, path);
      }
    },
    [onChange, onUploadComplete, onCommit]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      if (multiple) {
        const urls: string[] = [];
        for (const file of acceptedFiles) {
          const result = await uploadFile(file);
          if (result) urls.push(result.url);
        }
        if (urls.length > 0 && onMultipleUpload) {
          onMultipleUpload(urls);
        }
        return;
      }

      const file = acceptedFiles[0];
      const result = await uploadFile(file);
      if (result) {
        finalizeUpload(result.url, result.path);
      }
    },
    [uploadFile, finalizeUpload, multiple, onMultipleUpload]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: maxFiles,
    multiple: multiple,
    disabled: isUploading,
  });

  const handleUrlChange = (newUrl: string) => {
    setUrlInput(newUrl);
    setPreviewFailed(false);
    if (!onCommit) {
      onChange(newUrl);
    }
  };

  const handleUrlCommit = () => {
    if (onCommit) {
      onCommit(urlInput);
      setUrlInput("");
    } else {
      onChange(urlInput);
    }
  };

  const handleClear = () => {
    setUrlInput("");
    setPreviewFailed(false);
    onChange("");
  };

  const previewStyle = { width: previewSize, height: previewSize };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}

      <div className="flex gap-2">
        <Input
          value={urlInput}
          onChange={(e) => handleUrlChange(e.target.value)}
          onBlur={handleUrlCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleUrlCommit();
            }
          }}
          placeholder={placeholder}
          className="flex-1"
        />
        {urlInput && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            type="button"
            aria-label="Clear image"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or drag & drop</span>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
          transition-colors duration-200 ease-in-out
          ${isDragActive && !isDragReject ? "border-primary bg-primary/5" : ""}
          ${isDragReject ? "border-red-500 bg-red-50" : ""}
          ${!isDragActive ? "border-muted-foreground/30 hover:border-muted-foreground/50" : ""}
          ${isUploading ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <input {...getInputProps()} />

        {isUploading ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Uploading...</span>
          </div>
        ) : isDragActive ? (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-primary" />
            <span className="text-primary font-medium">Drop the image here</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Drag & drop or <span className="text-primary underline">click to browse</span>
            </span>
            <span className="text-xs text-muted-foreground">
              JPG, PNG, WebP, GIF
            </span>
          </div>
        )}
      </div>

      {uploadError && (
        <p className="text-sm text-red-500">{uploadError}</p>
      )}

      {urlInput && !previewFailed ? (
        <div className="mt-2">
          <div
            className={`
              relative rounded-lg overflow-hidden border w-32 h-32
              ${previewClassName || ""}
            `}
            style={previewStyle}
          >
            <Image
              src={urlInput}
              alt="Preview"
              fill
              unoptimized
              sizes={`${previewSize}px`}
              className="object-cover"
              onError={() => setPreviewFailed(true)}
            />
          </div>
        </div>
      ) : (
        <div
          className={`
            mt-2 rounded-lg border border-dashed flex items-center justify-center bg-muted/30 w-32 h-32
            ${previewClassName || ""}
          `}
          style={previewStyle}
        >
          <div className="text-center text-muted-foreground">
            <ImageIcon className="mx-auto h-8 w-8 mb-1" />
            <p className="text-xs">No image</p>
          </div>
        </div>
      )}
    </div>
  );
}
