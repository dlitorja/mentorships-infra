import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getB2Client, B2_BUCKET_NAME } from "./client";

export interface UploadInit {
  fileId: string;
  uploadId: string;
  key: string;
  partSize: number;
  partCount: number;
  presignedUrls: string[];
}

export interface UploadPart {
  partNumber: number;
  etag: string;
}

const DEFAULT_PART_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_PARTS = 200;
const URL_EXPIRY_SECONDS = 3600; // 1 hour

function generateKey(instructorId: string, fileId: string, filename: string): string {
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const date = new Date().toISOString().split("T")[0];
  return `${date}/${instructorId}/${fileId}/${sanitizedFilename}`;
}

export async function initiateMultipartUpload(params: {
  fileId: string;
  filename: string;
  contentType: string;
  size: number;
  instructorId: string;
}): Promise<UploadInit> {
  const client = getB2Client();
  const key = generateKey(params.instructorId, params.fileId, params.filename);
  
  const partSize = DEFAULT_PART_SIZE;
  const partCount = Math.ceil(params.size / partSize);
  
  if (partCount > MAX_PARTS) {
    throw new Error(`File too large. Maximum ${MAX_PARTS} parts allowed.`);
  }

  const command = new CreateMultipartUploadCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
    ContentType: params.contentType,
  });

  const response = await client.send(command);
  const uploadId = response.UploadId!;

  const presignedUrls: string[] = [];
  for (let i = 1; i <= partCount; i++) {
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: i,
      }),
      { expiresIn: URL_EXPIRY_SECONDS }
    );
    presignedUrls.push(url);
  }

  return {
    fileId: params.fileId,
    uploadId,
    key,
    partSize,
    partCount,
    presignedUrls,
  };
}

export async function getPresignedPartUrl(params: {
  key: string;
  uploadId: string;
  partNumber: number;
}): Promise<string> {
  const client = getB2Client();
  
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: B2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );
}

export async function completeMultipartUpload(params: {
  key: string;
  uploadId: string;
  parts: UploadPart[];
}): Promise<{ location: string; etag: string }> {
  const client = getB2Client();

  const command = new CompleteMultipartUploadCommand({
    Bucket: B2_BUCKET_NAME,
    Key: params.key,
    UploadId: params.uploadId,
    MultipartUpload: {
      Parts: params.parts.map((part) => ({
        ETag: part.etag,
        PartNumber: part.partNumber,
      })),
    },
  });

  const response = await client.send(command);
  return {
    location: response.Location!,
    etag: response.ETag!,
  };
}

export async function abortMultipartUpload(params: {
  key: string;
  uploadId: string;
}): Promise<void> {
  const client = getB2Client();

  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: B2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
    })
  );
}

export async function listUploadedParts(params: {
  key: string;
  uploadId: string;
}): Promise<UploadPart[]> {
  const client = getB2Client();

  const response = await client.send(
    new ListPartsCommand({
      Bucket: B2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
    })
  );

  return (response.Parts || []).map((part) => ({
    partNumber: part.PartNumber!,
    etag: part.ETag!,
  })) as UploadPart[];
}

export async function getUploadUrl(key: string): Promise<string> {
  const client = getB2Client();

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );
}

export async function getUploadDestination(key: string): Promise<string> {
  const client = getB2Client();

  const command = new PutObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: URL_EXPIRY_SECONDS });
}