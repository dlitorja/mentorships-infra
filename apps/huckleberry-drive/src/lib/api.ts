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
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function listFiles(): Promise<FileItem[]> {
  const data = await fetchApi<{ files: FileItem[]; pagination: { total: number; hasMore: boolean } }>(
    "/api/files"
  );
  return data.files;
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
  parts: Array<{ partNumber: number; etag: string }>
): Promise<void> {
  await fetchApi("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, uploadId, parts }),
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

export async function getDownloadUrl(fileId: string): Promise<string> {
  const data = await fetchApi<{ url: string }>(`/api/download/${fileId}`);
  return data.url;
}

export async function getCosts(): Promise<CostResponse> {
  return fetchApi<CostResponse>("/api/costs");
}