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
        // B2_ENDPOINT is bucket configuration — emitted only in the
        // opt-in block below, so it cannot drift from the dashboard value
        // (it was previously emitted twice).
        pushIfPresent("RESEND_API_KEY", process.env.RESEND_API_KEY);
        // Where the reconciliation job emails its drift report. Safe to
        // sync whenever present (not bucket configuration).
        pushIfPresent(
          "RECORDING_RECONCILIATION_ALERT_EMAIL",
          process.env.RECORDING_RECONCILIATION_ALERT_EMAIL
        );
        pushIfPresent("EMAIL_FROM", process.env.EMAIL_FROM);
        pushIfPresent("EMAIL_FROM_TRANSACTIONAL", process.env.EMAIL_FROM_TRANSACTIONAL);
        pushIfPresent("EMAIL_FROM_MARKETING", process.env.EMAIL_FROM_MARKETING);
        pushIfPresent("EMAIL_FROM_STAGING", process.env.EMAIL_FROM_STAGING);
        pushIfPresent("EMAIL_REPLY_TO", process.env.EMAIL_REPLY_TO);
        pushIfPresent("NEXT_PUBLIC_URL", process.env.NEXT_PUBLIC_URL);
        pushIfPresent("DAILY_API_KEY", process.env.DAILY_API_KEY);
        pushIfPresent(
          "CONVEX_TRIGGER_CALLBACK_SECRET",
          process.env.CONVEX_TRIGGER_CALLBACK_SECRET
        );
        // Bucket configuration is OPT-IN. `syncEnvVars` uses
        // `override: true`, so emitting these on every deploy means a
        // developer whose local `.env.local` still says
        // `instructor-uploads` / `us-west-002` silently reverts the
        // corrected dashboard values and re-breaks video-editor uploads,
        // bulk downloads and recordings. Guarding on "is it set locally"
        // is not enough — a *stale but present* value is just as harmful.
        //
        // The dashboard is therefore the source of truth. Set
        // SYNC_BUCKET_ENV_TO_TRIGGER=1 to deliberately push the local
        // bucket config (e.g. from CI when rotating buckets).
        if (process.env.SYNC_BUCKET_ENV_TO_TRIGGER === "1") {
          pushIfPresent("B2_BUCKET_NAME", process.env.B2_BUCKET_NAME);
          pushIfPresent("B2_REGION", process.env.B2_REGION);
          pushIfPresent("B2_ENDPOINT", process.env.B2_ENDPOINT);
          pushIfPresent("B2_DOWNLOAD_HOST", process.env.B2_DOWNLOAD_HOST);
          pushIfPresent(
            "RECORDINGS_BUCKET_NAME",
            process.env.RECORDINGS_BUCKET_NAME
          );
          pushIfPresent(
            "WORKSPACE_STORAGE_BUCKET_NAME",
            process.env.WORKSPACE_STORAGE_BUCKET_NAME
          );
          pushIfPresent(
            "WORKSPACE_STORAGE_BUCKET_REGION",
            process.env.WORKSPACE_STORAGE_BUCKET_REGION
          );
          pushIfPresent(
            "WORKSPACE_STORAGE_BUCKET_ENDPOINT",
            process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT
          );
        }
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
