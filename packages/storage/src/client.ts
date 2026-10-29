import { S3Client } from "@aws-sdk/client-s3";

const B2_REGION = process.env.B2_REGION || "us-west-002";
const B2_ENDPOINT = process.env.B2_ENDPOINT || `https://s3.${B2_REGION}.backblazeb2.com`;

let b2Client: S3Client | null = null;

function initializeB2Client(): S3Client {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set");
  }

  b2Client = new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
    // B2 does not require the SDK's default flexible checksums, and
    // computing them for a non-seekable web stream fails with
    // "Unable to calculate hash for flowing readable stream".
    // `uploadFromUrl` streams Daily recordings straight into a single
    // PutObjectCommand, so restrict checksum calculation to operations
    // that explicitly need it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return b2Client;
}

export function getB2Client(): S3Client {
  return b2Client ?? initializeB2Client();
}

export const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || "instructor-uploads";
export const B2_BUCKET_REGION = B2_REGION;
