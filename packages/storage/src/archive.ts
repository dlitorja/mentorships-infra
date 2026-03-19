import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  RestoreObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getB2Client, B2_BUCKET_NAME } from "./client";

const S3_REGION = process.env.AWS_S3_REGION || "us-east-1";
const S3_BUCKET = process.env.AWS_S3_BUCKET || "instructor-uploads-archive";

let s3Client: S3Client | null = null;

function initializeS3Client(): S3Client {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing AWS credentials: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set");
  }

  s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3Client;
}

function getS3Client(): S3Client {
  return s3Client ?? initializeS3Client();
}

export function getS3ArchiveKey(fileId: string, filename: string): string {
  const date = new Date().toISOString().split("T")[0];
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `archive/${date}/${fileId}/${sanitizedFilename}`;
}

export async function copyToS3(params: {
  fileId: string;
  b2Key: string;
  filename: string;
}): Promise<{ s3Key: string; s3Url: string }> {
  const b2Client = getB2Client();
  const s3ClientInstance = getS3Client();
  const s3Key = getS3ArchiveKey(params.fileId, params.filename);

  const getCommand = new GetObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: params.b2Key,
  });

  const b2Response = await b2Client.send(getCommand);
  
  const stream = b2Response.Body;
  if (!stream) {
    throw new Error("Failed to read B2 object stream");
  }

  if (typeof stream !== "object") {
    throw new Error("Unexpected B2 response body type");
  }

  const putCommand = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: stream,
    StorageClass: "DEEP_ARCHIVE",
    ContentType: b2Response.ContentType,
  });

  await s3ClientInstance.send(putCommand);

  const s3Url = `s3://${S3_BUCKET}/${s3Key}`;

  return { s3Key, s3Url };
}

export async function verifyS3Upload(s3Key: string): Promise<boolean> {
  const client = getS3Client();

  try {
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      })
    );

    return response.StorageClass === "DEEP_ARCHIVE";
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFound" || 
       error.name === "NoSuchKey" ||
       (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
    ) {
      return false;
    }
    throw error;
  }
}

export async function deleteFromB2(b2Key: string): Promise<void> {
  const { deleteFile } = await import("./files");
  await deleteFile(b2Key);
}

export async function deleteFromS3(s3Key: string): Promise<void> {
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    })
  );
}

export async function getS3DownloadUrl(
  s3Key: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function restoreFromGlacier(s3Key: string, days: number = 5): Promise<string> {
  const client = getS3Client();

  await client.send(
    new RestoreObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      RestoreRequest: {
        Days: days,
        GlacierJobParameters: { Tier: "Standard" },
      },
    })
  );

  return `Restoration initiated for ${s3Key}. Available in 12-48 hours for DEEP_ARCHIVE.`;
}
