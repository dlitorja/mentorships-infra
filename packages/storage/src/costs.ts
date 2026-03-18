export interface StorageCosts {
  b2Storage: number;
  b2Download: number;
  b2Api: number;
  s3Storage: number;
  s3Retrieval: number;
  total: number;
  month: string;
}

const B2_STORAGE_RATE_PER_GB = 0.006;
const B2_CLASS_A_RATE_PER_1000 = 0.004;
const B2_CLASS_B_RATE_PER_1000 = 0.002;
const S3_GLACIER_DEEP_ARCHIVE_RATE_PER_GB = 0.00099;

export function estimateB2StorageCost(bytes: number): number {
  const gb = bytes / (1024 * 1024 * 1024);
  return Math.round(gb * B2_STORAGE_RATE_PER_GB * 100);
}

export function estimateS3StorageCost(bytes: number): number {
  const gb = bytes / (1024 * 1024 * 1024);
  return Math.round(gb * S3_GLACIER_DEEP_ARCHIVE_RATE_PER_GB * 100);
}

export function calculateUploadTransactionCost(uploadCount: number): number {
  return Math.round((uploadCount / 1000) * B2_CLASS_A_RATE_PER_1000 * 100);
}

export function calculateDownloadTransactionCost(downloadCount: number): number {
  return Math.round((downloadCount / 1000) * B2_CLASS_B_RATE_PER_1000 * 100);
}

export async function fetchMonthlyCosts(): Promise<StorageCosts> {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return {
    b2Storage: 0,
    b2Download: 0,
    b2Api: 0,
    s3Storage: 0,
    s3Retrieval: 0,
    total: 0,
    month,
  };
}

export async function checkCostThreshold(
  currentCosts: number,
  thresholdCents: number = 5000
): Promise<boolean> {
  return currentCosts > thresholdCents;
}

export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatBytesToGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}