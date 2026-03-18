export { createB2Client, getB2Client, B2_BUCKET_NAME, B2_BUCKET_REGION } from "./client";

export {
  initiateMultipartUpload,
  getPresignedPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  listUploadedParts,
  getUploadDestination,
  type UploadInit,
  type UploadPart,
} from "./uploads";

export {
  getDownloadUrl,
  getDownloadUrlWithContentDisposition,
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
  copyToS3,
  verifyS3Upload,
  deleteFromB2,
  deleteFromS3,
  getS3DownloadUrl,
  restoreFromGlacier,
  getS3ArchiveKey,
} from "./archive";

export {
  fetchMonthlyCosts,
  checkCostThreshold,
  formatCost,
  formatBytesToGB,
  estimateB2StorageCost,
  estimateS3StorageCost,
  calculateUploadTransactionCost,
  calculateDownloadTransactionCost,
  type StorageCosts,
} from "./costs";