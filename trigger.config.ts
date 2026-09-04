import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_fvyorgaijayllujsxzgb",
  runtime: "node-24",
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
      //
      // IMPORTANT: `syncEnvVars` defaults to `override: true`, which
      // would overwrite any existing production secret with an empty
      // string on a deploy from a machine that lacks the secret in
      // its local env. We guard against that by only emitting a row
      // when the local process.env value is non-empty. CI deploys
      // that have these secrets in env still push them; a developer
      // deploy from a machine without them leaves production env
      // untouched. Defaults that have safe public fallbacks (B2
      // bucket name, B2 region, B2 download host) are still emitted
      // because they're not secrets.
      syncEnvVars(async () => {
        const emitted: Array<{ name: string; value: string }> = [];
        const pushIfPresent = (name: string, raw: string | undefined) => {
          const value = raw?.trim();
          if (value && value.length > 0) {
            emitted.push({ name, value });
          }
        };
        pushIfPresent("NEXT_PUBLIC_CONVEX_URL", process.env.NEXT_PUBLIC_CONVEX_URL);
        pushIfPresent("CONVEX_HTTP_KEY", process.env.CONVEX_HTTP_KEY);
        pushIfPresent("B2_KEY_ID", process.env.B2_KEY_ID);
        pushIfPresent("B2_APPLICATION_KEY", process.env.B2_APPLICATION_KEY);
        pushIfPresent("B2_ENDPOINT", process.env.B2_ENDPOINT);
        pushIfPresent("RESEND_API_KEY", process.env.RESEND_API_KEY);
        pushIfPresent("EMAIL_FROM", process.env.EMAIL_FROM);
        pushIfPresent("EMAIL_REPLY_TO", process.env.EMAIL_REPLY_TO);
        pushIfPresent("NEXT_PUBLIC_URL", process.env.NEXT_PUBLIC_URL);
        pushIfPresent("DAILY_API_KEY", process.env.DAILY_API_KEY);
        pushIfPresent(
          "CONVEX_TRIGGER_CALLBACK_SECRET",
          process.env.CONVEX_TRIGGER_CALLBACK_SECRET
        );
        emitted.push({
          name: "B2_BUCKET_NAME",
          value: process.env.B2_BUCKET_NAME ?? "instructor-uploads",
        });
        emitted.push({
          name: "B2_REGION",
          value: process.env.B2_REGION ?? "us-west-002",
        });
        emitted.push({
          name: "B2_DOWNLOAD_HOST",
          value: process.env.B2_DOWNLOAD_HOST ?? "download.backblazeb2.com",
        });
        return emitted;
      }),
    ],
    external: [
      "archiver",
      "@aws-sdk/client-s3",
      "@aws-sdk/lib-storage",
      "@aws-sdk/s3-request-presigner",
      "pdfkit",
      "@react-email/render",
    ],
    autoDetectExternal: true,
    keepNames: true,
    minify: false,
  },
});
