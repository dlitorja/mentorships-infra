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
  limitBytes: number | null;
  fileCount: number;
  instructorCount?: number;
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

export interface HdInvitation {
  id: string;
  email: string;
  role: "student" | "instructor" | "admin" | "video_editor";
  status: "pending" | "accepted" | "expired" | "cancelled";
  clerkInvitationId: string | null;
  invitedByUserId: string;
  expiresAt: number;
  createdAt: number;
}

export interface InvitationListResponse {
  items: HdInvitation[];
  total: number;
}

export interface InvitationStats {
  total: number;
  pending: number;
  accepted: number;
  expired: number;
  cancelled: number;
}

export type UserRole = "student" | "instructor" | "admin" | "video_editor";

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

export async function listHdInvitations(): Promise<InvitationListResponse> {
  return fetchApi<InvitationListResponse>("/api/admin/invitations");
}

export async function createHdInvitation(
  email: string,
  role: UserRole,
  expiresInDays?: number
): Promise<{ invitationId: string }> {
  return fetchApi<{ invitationId: string }>("/api/admin/invitations/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role, expiresInDays }),
  });
}

export async function cancelHdInvitation(invitationId: string): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>("/api/admin/invitations/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitationId }),
  });
}

export async function deleteHdInvitation(invitationId: string): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>("/api/admin/invitations/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitationId }),
  });
}

export async function resendHdInvitation(invitationId: string, expiresInDays?: number): Promise<{ success: boolean; newExpiresAt: number }> {
  return fetchApi<{ success: boolean; newExpiresAt: number }>("/api/admin/invitations/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitationId, expiresInDays }),
  });
}

export interface AdminUser {
  _id: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  timeZone?: string;
  clerkId: string;
  createdAt: number;
  deletedAt?: number;
  deletedBy?: string;
}

export interface DeletedUser extends AdminUser {
  deletedAt: number;
  deletedBy: string;
}

export interface UsersListResponse {
  active: AdminUser[];
  deleted: DeletedUser[];
}

export interface UserWithFiles {
  user: AdminUser;
  files: {
    total: number;
    active: number;
    totalBytes: number;
    activeBytes: number;
  };
}

export async function getAdminUsers(): Promise<UsersListResponse> {
  return fetchApi<UsersListResponse>("/api/admin/users");
}

export async function updateUserRole(userId: string, role: UserRole): Promise<{ success: boolean; user: AdminUser }> {
  return fetchApi<{ success: boolean; user: AdminUser }>(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export async function softDeleteUser(userId: string): Promise<{
  success: boolean;
  userId: string;
  filesCount: number;
  activeFilesCount: number;
}> {
  return fetchApi(`/api/admin/users/${userId}/soft-delete`, {
    method: "POST",
  });
}

export async function restoreUser(userId: string): Promise<{ success: boolean; userId: string }> {
  return fetchApi(`/api/admin/users/${userId}/restore`, {
    method: "POST",
  });
}

export async function hardDeleteUser(userId: string): Promise<{
  success: boolean;
  userId: string;
  filesQueued: number;
  totalBytes: number;
}> {
  return fetchApi(`/api/admin/users/${userId}/hard-delete`, {
    method: "POST",
  });
}

export interface OrphanedFile {
  key: string;
  size: number;
  lastModified: string;
}

export interface OrphanedFilesResponse {
  files: OrphanedFile[];
  totalCount: number;
  totalBytes: number;
}

export async function getOrphanedFiles(): Promise<OrphanedFilesResponse> {
  return fetchApi<OrphanedFilesResponse>("/api/admin/storage/orphaned-files");
}

export async function cleanupOrphanedFiles(keys: string[]): Promise<{
  success: boolean;
  deleted: number;
  failed: number;
  total: number;
  errors?: string[];
}> {
  return fetchApi("/api/admin/storage/orphaned-files/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
}