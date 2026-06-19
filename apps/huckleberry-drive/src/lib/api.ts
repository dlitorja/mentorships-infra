export interface FileItem {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  status: string;
  transferStatus: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  errorMessage: string | null;
  instructorId?: string;
  uploadedById?: string;
  deletedAt?: number | null;
}

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  fileCount: number;
}

export interface UploadInitiateResponse {
  fileId: string;
  uploadId: string;
  key: string;
  partSize: number;
  partCount: number;
  presignedUrls: string[];
}

export interface CostData {
  month: string;
  b2StorageCost: number;
  b2DownloadCost: number;
  b2ApiCost: number;
  s3StorageCost: number;
  s3RetrievalCost: number;
  totalCost: number;
}

export interface CostResponse {
  currentMonth: CostData;
  historical: CostData[];
}

export interface AdminStats {
  totalInstructors: number;
  totalFiles: number;
  totalBytes: number;
  activeFiles: number;
  activeBytes: number;
}

export interface InstructorOption {
  id: string;
  name: string | null;
  email: string;
}

export interface FileListResponse {
  files: FileItem[];
  pagination: { cursor: number | null; hasMore: boolean };
}

export interface BulkDownloadStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  fileCount: number;
  downloadUrl?: string;
  error?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface ListFilesParams {
  instructorId?: string;
  uploadedById?: string;
  status?: string;
  search?: string;
  cursor?: number;
  limit?: number;
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    const code = error.code ? ` [${error.code}]` : "";
    const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
    throw new Error((error.error || `HTTP ${response.status}`) + code + details);
  }

  return response.json();
}

export async function listFiles(): Promise<FileItem[]> {
  const data = await fetchApi<{ files: FileItem[]; pagination: { total: number; hasMore: boolean } }>(
    "/api/files"
  );
  return data.files;
}

export async function listFilesWithParams(
  params: ListFilesParams = {}
): Promise<FileListResponse> {
  const searchParams = new URLSearchParams();
  if (params.instructorId) searchParams.set("instructorId", params.instructorId);
  if (params.uploadedById) searchParams.set("uploadedById", params.uploadedById);
  if (params.status) searchParams.set("status", params.status);
  if (params.search) searchParams.set("search", params.search);
  if (params.cursor !== undefined) searchParams.set("cursor", String(params.cursor));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));

  const query = searchParams.toString();
  return fetchApi<FileListResponse>(`/api/files${query ? `?${query}` : ""}`);
}

export async function getAdminStats(): Promise<AdminStats> {
  return fetchApi<AdminStats>("/api/admin/stats");
}

export async function getAdminInstructors(): Promise<InstructorOption[]> {
  const data = await fetchApi<{ instructors: InstructorOption[] }>("/api/admin/instructors");
  return data.instructors;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  return fetchApi<StorageUsage>("/api/storage-usage");
}

export async function initiateUpload(
  filename: string,
  contentType: string,
  size: number,
  instructorId?: string
): Promise<UploadInitiateResponse> {
  return fetchApi<UploadInitiateResponse>("/api/uploads/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size, instructorId }),
  });
}

export async function completeUpload(
  fileId: string,
  uploadId: string,
  key: string,
  parts: Array<{ partNumber: number; etag: string }>
): Promise<void> {
  await fetchApi("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, uploadId, key, parts }),
  });
}

export async function abortUpload(fileId: string, uploadId: string): Promise<void> {
  await fetchApi("/api/uploads/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, uploadId }),
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  await fetchApi(`/api/files/${fileId}`, {
    method: "DELETE",
  });
}

export async function restoreFile(fileId: string): Promise<void> {
  await fetchApi<{ success?: boolean; error?: string }>(
    `/api/files/${fileId}`,
    { method: "POST" }
  );
}

export async function hardDeleteFile(fileId: string): Promise<void> {
  await fetchApi(`/api/files/${fileId}/hard`, {
    method: "DELETE",
  });
}

export async function getStreamUrl(fileId: string, expiresIn?: number): Promise<string> {
  const params = expiresIn ? `?expiresIn=${expiresIn}` : "";
  const data = await fetchApi<{ url: string }>(`/api/files/${fileId}/stream${params}`);
  return data.url;
}

export async function getDownloadUrl(fileId: string): Promise<string> {
  const data = await fetchApi<{ url: string }>(`/api/download/${fileId}`);
  return data.url;
}

export async function getCosts(): Promise<CostResponse> {
  return fetchApi<CostResponse>("/api/costs");
}

export async function requestBulkDownload(fileIds: string[]): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>("/api/files/bulk-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds }),
  });
}

export async function getBulkDownloadStatus(jobId: string): Promise<BulkDownloadStatus> {
  return fetchApi<BulkDownloadStatus>(`/api/files/bulk-download/${jobId}`);
}