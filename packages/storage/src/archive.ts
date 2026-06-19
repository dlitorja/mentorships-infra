import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "./client";

export async function deleteFromB2(b2Key: string): Promise<void> {
  const { deleteFile } = await import("./files");
  await deleteFile(b2Key);
}

export async function deleteFromS3(s3Key: string): Promise<void> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing AWS credentials: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set");
  }

  const { S3Client } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.AWS_S3_REGION || "us-east-1",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    throw new Error("Missing AWS_S3_BUCKET environment variable");
  }

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    })
  );
}