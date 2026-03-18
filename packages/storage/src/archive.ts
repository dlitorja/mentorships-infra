import {
  S3Client,
  CopyObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3_REGION = process.env.AWS_S3_REGION || "us-east-1";
const S3_BUCKET = process.env.AWS_S3_BUCKET || "instructor-uploads-archive";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  return s3Client;
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
  const client = getS3Client();
  const s3Key = getS3ArchiveKey(params.fileId, params.filename);

  const copySource = encodeURIComponent(
    `${process.env.B2_BUCKET_NAME}/${params.b2Key}`
  );

  const command = new CopyObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    CopySource: copySource,
    StorageClass: "DEEP_ARCHIVE",
    MetadataDirective: "COPY",
  });

  await client.send(command);

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
    return false;
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

export async function restoreFromGlacier(s3Key: string, _days: number = 5): Promise<string> {
  const client = getS3Client();

  const restoreCommand = new CopyObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    CopySource: `${S3_BUCKET}/${s3Key}`,
    MetadataDirective: "COPY",
    StorageClass: "STANDARD",
  });

  await client.send(restoreCommand);

  return `Restoration initiated for ${s3Key}. Available in 3-5 hours.`;
}