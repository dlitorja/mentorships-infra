#!/usr/bin/env node
if (!process.env.CONVEX_DEPLOY_KEY) {
  console.log("Skipping convex codegen: CONVEX_DEPLOY_KEY not set");
  process.exit(0);
}
const { execSync } = require("child_process");
execSync("npx convex codegen", { stdio: "inherit" });