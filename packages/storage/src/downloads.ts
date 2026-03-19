import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getB2Client, B2_BUCKET_NAME } from "./client";

const DEFAULT_URL_EXPIRY = 3600; // 1 hour

function sanitizeFilename(filename: string): string {
  return filename.replace(/["\r\n;]/g, "_").slice(0, 255);
}

export async function getDownloadUrl(
  key: string,
  expiresInSeconds: number = DEFAULT_URL_EXPIRY
): Promise<string> {
  const client = getB2Client();

  const command = new GetObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function getDownloadUrlWithContentDisposition(
  key: string,
  filename: string,
  expiresInSeconds: number = DEFAULT_URL_EXPIRY
): Promise<string> {
  const client = getB2Client();

  const command = new GetObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"`,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export function parseKeyFromS3Url(url: string): string | null {
  const match = url.match(/s3\.[^/]+\.backblazeb2\.com\/[^/]+\/(.+?)(?:\?|$)/);
  return match?.[1] ?? null;
}

export function buildB2Url(key: string): string {
  const endpoint = process.env.B2_ENDPOINT || `https://s3.${process.env.B2_REGION || "us-west-002"}.backblazeb2.com`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${B2_BUCKET_NAME}/${encodedKey}`;
}