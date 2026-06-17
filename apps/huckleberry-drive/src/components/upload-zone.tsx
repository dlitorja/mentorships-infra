"use client";

import React, { useState, useCallback, useRef } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  Upload,
  X,
  Pause,
  Play,
  AlertCircle,
  Film,
} from "lucide-react";
import { initiateUpload, completeUpload, abortUpload } from "@/lib/api";

const ACCEPTED_VIDEO_TYPES = {
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/x-msvideo": [".avi"],
  "video/webm": [".webm"],
  "video/x-matroska": [".mkv"],
  "video/mpeg": [".mpeg", ".mpg"],
};

const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024; // 20GB
const MAX_CONCURRENT_UPLOADS = 2;

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "paused" | "completed" | "error";
  error?: string;
  fileId?: string;
  uploadId?: string;
  parts: Array<{ partNumber: number; etag?: string }>;
  uploadedParts: number;
  partSize?: number;


              ? { ...f, fileId: initiateResult.fileId, uploadId: initiateResult.uploadId, partSize: initiateResult.partSize }

                    {uploadingFile.uploadedParts} / {uploadingFile.parts.length > 0 ? uploadingFile.parts.length : Math.ceil(uploadingFile.file.size / (uploadingFile.partSize ?? (100 * 1024 * 1024)))} parts
