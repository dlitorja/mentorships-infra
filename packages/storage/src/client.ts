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
  });

  return b2Client;
}

export function getB2Client(): S3Client {
  return b2Client ?? initializeB2Client();
}

export const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || "instructor-uploads";
// PR workspace-storage-1: separate bucket for workspace uploads
// (images, chat files, note attachments). Lives in the same B2 account
// but is namespaced from instructor uploads so workspace retention
// cannot accidentally delete instructor-uploaded recordings. The
// workspace bucket lives in `us-east-005`; this client deliberately
// does NOT share `B2_REGION` because the existing instructor bucket
// defaults to `us-west-002` and switching the shared default would
// break existing uploads/downloads (Greptile P1).
export const WORKSPACE_STORAGE_BUCKET_NAME =
  process.env.WORKSPACE_STORAGE_BUCKET_NAME || "mentorship-workspace-storage";
export const WORKSPACE_STORAGE_BUCKET_REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION || "us-east-005";
export const B2_BUCKET_REGION = B2_REGION;
