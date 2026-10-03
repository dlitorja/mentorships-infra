#!/usr/bin/env node
// Runs as a pnpm postinstall hook.
//
// Goal: refresh `convex/_generated/` so tsc passes against the deployed
// Convex schema. There is no Convex CLI mode that generates types without
// also uploading functions to the configured deployment, so this script
// is the only place where CI and local dev touch Convex outside of
// `pnpm convex:deploy`.
//
// Skip conditions (in order):
//   1. No CONVEX_DEPLOY_KEY. Local dev without a deploy key can't reach a
//      deployment; we just skip and let the committed _generated/ tree be
//      used by tsc.
//   2. Running inside a GitHub Actions pull_request workflow. PRs must
//      not upload functions to the production deployment — see the
//      comment on the `convex-codegen` job in `.github/workflows/ci.yml`.
//      The freshness check still happens against the committed
//      _generated/ tree in the downstream typecheck jobs.
if (!process.env.CONVEX_DEPLOY_KEY) {
  console.log("Skipping convex codegen: CONVEX_DEPLOY_KEY not set");
  process.exit(0);
}
if (process.env.GITHUB_EVENT_NAME === "pull_request") {
  console.log(
    "Skipping convex codegen: GITHUB_EVENT_NAME=pull_request (would upload functions to the configured deployment)",
  );
  process.exit(0);
}
const { execSync } = require("child_process");
execSync("npx convex codegen", { stdio: "inherit" });
