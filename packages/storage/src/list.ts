import { ListObjectsV2Command, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { z } from "zod";
import { getB2Client, B2_BUCKET_NAME } from "./client";

const b2ObjectSchema = z.object({
  key: z.string(),
  size: z.number(),
  lastModified: z.date(),
  etag: z.string(),
  storageClass: z.string().optional(),
});

export type B2Object = z.infer<typeof b2ObjectSchema>;

export interface ListB2ObjectsOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListB2ObjectsResult {
  objects: B2Object[];
  isTruncated: boolean;
  nextContinuationToken: string | null;
  keyCount: number;
  totalSize: number;
}

export async function listB2Objects(
  options: ListB2ObjectsOptions = {}
): Promise<ListB2ObjectsResult> {
  const { prefix = "", maxKeys = 1000, continuationToken } = options;
  const client = getB2Client();

  const command = new ListObjectsV2Command({
    Bucket: B2_BUCKET_NAME,
    Prefix: prefix,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
  });

  const response: ListObjectsV2CommandOutput = await client.send(command);

  const objects: B2Object[] = [];
  let totalSize = 0;

  if (response.Contents) {
    for (const item of response.Contents) {
      if (item.Key) {
        const parsed = b2ObjectSchema.safeParse({
          key: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified ?? new Date(0),
          etag: item.ETag ?? "",
          storageClass: item.StorageClass,
        });
        if (parsed.success) {
          objects.push(parsed.data);
          totalSize += parsed.data.size;
        } else {
          console.warn("[listB2Objects] Failed to parse B2 object:", {
            key: item.Key,
            error: parsed.error,
          });
        }
      }
    }
  }

  return {
    objects,
    isTruncated: response.IsTruncated ?? false,
    nextContinuationToken: response.NextContinuationToken ?? null,
    keyCount: response.KeyCount ?? objects.length,
    totalSize,
  };
}

export async function listAllB2Objects(
  prefix?: string,
  onProgress?: (objects: B2Object[], hasMore: boolean) => void
): Promise<B2Object[]> {
  const allObjects: B2Object[] = [];
  let continuationToken: string | undefined;
  let hasMore = true;

  while (hasMore && continuationToken !== undefined) {
    const result = await listB2Objects({
      prefix,
      maxKeys: 1000,
      continuationToken,
    });

    allObjects.push(...result.objects);
    hasMore = result.isTruncated && result.nextContinuationToken !== null;
    continuationToken = result.nextContinuationToken ?? undefined;

    if (onProgress) {
      onProgress(result.objects, result.isTruncated);
    }
  }

  return allObjects;
}