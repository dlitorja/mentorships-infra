export { getB2Client, B2_BUCKET_NAME, B2_BUCKET_REGION } from "./client";

export {
  initiateMultipartUpload,
  getPresignedPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  listUploadedParts,
  getUploadDestination,
  uploadFromUrl,
  getB2Auth,
  listFileVersions,
  deleteFileVersion,
  deleteAllVersionsFromB2,
  MAX_MULTIPART_UPLOAD_BYTES,
  DEFAULT_PART_SIZE,
  MAX_PARTS,
  type UploadInit,
  type UploadPart,
  type UploadFromUrlParams,
  type UploadFromUrlResult,
} from "./uploads";

export {
  getDownloadUrl,
  getDownloadUrlWithContentDisposition,
  getStreamUrl,
  parseKeyFromS3Url,
  buildB2Url,
} from "./downloads";

export {
  deleteFile,
  headFile,
  fileExists,
  extractFilenameFromKey,
  extractDateFromKey,
  type FileMetadata,
} from "./files";

export {
  listB2Objects,
  listAllB2Objects,
  type B2Object,
  type ListB2ObjectsOptions,
  type ListB2ObjectsResult,
} from "./list";

export {
  deleteFromB2,
  deleteFromS3,
} from "./archive";

export {
  BULK_DOWNLOAD_JOB_EXPIRY_HOURS,
  MAX_BYTES_PER_CHUNK,
  MAX_FILES_PER_CHUNK,
  chunkFiles,
  createChunkSummary,
  getChunkStatus,
  getJobStatus,
  isChunkCompleted,
  isChunkFailed,
  saveChunkStatus,
  saveJobStatus,
  updateChunkSummary,
  type BulkDownloadChunk,
  type BulkDownloadChunkSummary,
  type BulkDownloadFile,
  type BulkDownloadJob,
  type BulkDownloadJobStatus,
} from "./bulk-download-jobs";

export {
  fetchMonthlyCosts,
  checkCostThreshold,
  formatCost,
  formatBytesToGB,
  estimateB2StorageCost,
  calculateUploadTransactionCost,
  calculateDownloadTransactionCost,
  type StorageCosts,
} from "./costs";