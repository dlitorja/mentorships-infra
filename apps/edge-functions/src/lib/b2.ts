import { AwsClient } from "aws4fetch";

interface Env {
  B2_ENDPOINT: string;
  B2_ACCESS_KEY_ID: string;
  B2_SECRET_ACCESS_KEY: string;
  B2_BUCKET_NAME: string;
  B2_REGION?: string;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/["\r\n;]/g, "_").slice(0, 255);
}

export async function getDownloadUrlWithContentDisposition(
  env: Env,
  key: string,
  filename: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.B2_ACCESS_KEY_ID,
    secretAccessKey: env.B2_SECRET_ACCESS_KEY,
    service: "s3",
    region: env.B2_REGION || "us-west-002",
  });

  const endpoint = env.B2_ENDPOINT.replace(/\/+$/, "");
  const url = new URL(`${endpoint}/${env.B2_BUCKET_NAME}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  url.searchParams.set(
    "response-content-disposition",
    `attachment; filename="${sanitizeFilename(filename)}"`
  );

  const signedRequest = await client.sign(
    new Request(url.toString(), { method: "GET" }),
    { aws: { signQuery: true } }
  );

  return signedRequest.url.toString();
}

export async function getStreamUrl(
  env: Env,
  key: string,
  contentType: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.B2_ACCESS_KEY_ID,
    secretAccessKey: env.B2_SECRET_ACCESS_KEY,
    service: "s3",
    region: env.B2_REGION || "us-west-002",
  });

  const endpoint = env.B2_ENDPOINT.replace(/\/+$/, "");
  const url = new URL(`${endpoint}/${env.B2_BUCKET_NAME}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  url.searchParams.set("response-content-type", contentType);

  const signedRequest = await client.sign(
    new Request(url.toString(), { method: "GET" }),
    { aws: { signQuery: true } }
  );

  return signedRequest.url.toString();
}
