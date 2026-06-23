export { getB2Client, B2_BUCKET_NAME, B2_BUCKET_REGION } from "./client";

export {
  initiateMultipartUpload,
  getPresignedPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  listUploadedParts,
  getUploadDestination,
  getB2Auth,
  listFileVersions,
  deleteFileVersion,
  deleteAllVersionsFromB2,
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
  fetchMonthlyCosts,
  checkCostThreshold,
  formatCost,
  formatBytesToGB,
  estimateB2StorageCost,
  calculateUploadTransactionCost,
  calculateDownloadTransactionCost,
  type StorageCosts,
} from "./costs";