import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "./client";

export interface FileMetadata {
  key: string;
  size?: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
}

export async function deleteFile(key: string): Promise<void> {
  const client = getB2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
    })
  );
}

export async function headFile(key: string): Promise<FileMetadata | null> {
  const client = getB2Client();

  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
      })
    );

    return {
      key,
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag,
    };
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === "NotFound" || err.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

export async function fileExists(key: string): Promise<boolean> {
  const metadata = await headFile(key);
  return metadata !== null;
}

export function extractFilenameFromKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? "";
}

export function extractDateFromKey(key: string): string | null {
  const parts = key.split("/");
  return parts[0] ?? null;
}