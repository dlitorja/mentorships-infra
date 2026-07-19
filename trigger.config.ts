import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_fvyorgaijayllujsxzgb",
  runtime: "node",
  logLevel: "info",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      additionalFiles({
        files: [
          "packages/storage/**",
          "packages/db/**",
          "packages/emails/**",
          "packages/schemas/**",
          "packages/payments/**",
        ],
      }),
      // PR #4b-fix: sync the env vars the workspace-export task
      // reads. Without these, `process.env.NEXT_PUBLIC_CONVEX_URL`,
      // `CONVEX_HTTP_KEY`, and the B2 credentials are undefined at
      // runtime in deploy builds and the task fails with
      // "Convex deployment URL or HTTP key not configured".
      syncEnvVars(async () => [
        { name: "NEXT_PUBLIC_CONVEX_URL", value: process.env.NEXT_PUBLIC_CONVEX_URL ?? "" },
        { name: "CONVEX_HTTP_KEY", value: process.env.CONVEX_HTTP_KEY ?? "" },
        { name: "B2_KEY_ID", value: process.env.B2_KEY_ID ?? "" },
        { name: "B2_APPLICATION_KEY", value: process.env.B2_APPLICATION_KEY ?? "" },
        { name: "B2_BUCKET_NAME", value: process.env.B2_BUCKET_NAME ?? "instructor-uploads" },
        { name: "B2_REGION", value: process.env.B2_REGION ?? "us-west-002" },
        { name: "B2_ENDPOINT", value: process.env.B2_ENDPOINT ?? "" },
        { name: "B2_DOWNLOAD_HOST", value: process.env.B2_DOWNLOAD_HOST ?? "download.backblazeb2.com" },
        { name: "RESEND_API_KEY", value: process.env.RESEND_API_KEY ?? "" },
        { name: "EMAIL_FROM", value: process.env.EMAIL_FROM ?? "" },
        { name: "EMAIL_REPLY_TO", value: process.env.EMAIL_REPLY_TO ?? "" },
        { name: "NEXT_PUBLIC_URL", value: process.env.NEXT_PUBLIC_URL ?? "" },
      ]),
    ],
    external: [
      "archiver",
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-request-presigner",
      "pdfkit",
      "@react-email/render",
    ],
    autoDetectExternal: true,
    keepNames: true,
    minify: false,
  },
});
