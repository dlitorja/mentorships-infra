import { S3Client } from "@aws-sdk/client-s3";

const B2_REGION = process.env.B2_REGION || "us-west-002";
const B2_ENDPOINT = process.env.B2_ENDPOINT || `https://s3.${B2_REGION}.backblazeb2.com`;

let b2Client: S3Client | null = null;

export function createB2Client(): S3Client {
  if (b2Client) return b2Client;

  b2Client = new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID!,
      secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
    forcePathStyle: true,
  });

  return b2Client;
}

export function getB2Client(): S3Client {
  if (!b2Client) {
    return createB2Client();
  }
  return b2Client;
}

export const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || "instructor-uploads";
export const B2_BUCKET_REGION = B2_REGION;