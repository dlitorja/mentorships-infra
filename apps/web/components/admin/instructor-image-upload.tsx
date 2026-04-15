"use client";

import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";

interface InstructorImageUploadProps {
  label: string;
  value?: string;
  onChange: (url: string) => void;
  uploadEndpoint?: string;
  placeholder?: string;
}

const ACCEPTED_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
};

export function InstructorImageUpload({
  label,
  value,
  onChange,
  uploadEndpoint = "/api/instructor/mentees-results/upload",
  placeholder = "https://example.com/image.jpg",
}: InstructorImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(value || "");

  const uploadFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setUploadError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(uploadEndpoint, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Upload failed");
        }

        const data = await response.json();
        onChange(data.url);
        setUrlInput(data.url);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [uploadEndpoint, onChange]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        uploadFile(acceptedFiles[0]);
      }
    },
    [uploadFile]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    multiple: false,
    disabled: isUploading,
  });

  const handleUrlChange = (newUrl: string) => {
    setUrlInput(newUrl);
    onChange(newUrl);
  };

  const handleClear = () => {
    setUrlInput("");
    onChange("");
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* URL Input */}
      <div className="flex gap-2">
        <Input
          value={urlInput}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        {urlInput && (
          <Button variant="ghost" size="icon" onClick={handleClear} type="button">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* OR divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or drag & drop</span>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
          transition-colors duration-200 ease-in-out
          ${isDragActive && !isDragReject ? "border-primary bg-primary/5" : ""}
          ${isDragReject ? "border-red-500 bg-red-5" : ""}
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

      {/* Error message */}
      {uploadError && (
        <p className="text-sm text-red-500">{uploadError}</p>
      )}

      {/* Preview */}
      {urlInput && (
        <div className="mt-2 relative w-32 h-32 rounded-lg overflow-hidden border">
          <img
            src={urlInput}
            alt="Preview"
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
            }}
          />
        </div>
      )}

      {!urlInput && (
        <div className="mt-2 w-32 h-32 rounded-lg border border-dashed flex items-center justify-center bg-muted/30">
          <div className="text-center text-muted-foreground">
            <ImageIcon className="mx-auto h-8 w-8 mb-1" />
            <p className="text-xs">No image</p>
          </div>
        </div>
      )}
    </div>
  );
}
