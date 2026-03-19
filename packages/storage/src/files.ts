import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { getB2Client, B2_BUCKET_NAME } from "./client";

const fileMetadataSchema = z.object({
  key: z.string(),
  size: z.number().optional(),
  contentType: z.string().optional(),
  lastModified: z.date().optional(),
  etag: z.string().optional(),
});

export type FileMetadata = z.infer<typeof fileMetadataSchema>;

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

    const rawMetadata = {
      key,
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      etag: response.ETag,
    };

    return fileMetadataSchema.parse(rawMetadata);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return null;
    }
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
  if (parts[0] === "archive" && parts.length > 1) {
    return parts[1] ?? null;
  }
  return parts[0] ?? null;
}