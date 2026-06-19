import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "./client";

export async function deleteFromB2(b2Key: string): Promise<void> {
  const { deleteFile } = await import("./files");
  await deleteFile(b2Key);
}

export async function deleteFromS3(s3Key: string): Promise<void> {
  const client = new (await import("@aws-sdk/client-s3")).S3Client({
    region: process.env.AWS_S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  await client.send(
    new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET || "instructor-uploads-archive",
      Key: s3Key,
    })
  );
}