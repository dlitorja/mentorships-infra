#!/usr/bin/env bash
set -euo pipefail

# Triggers a Vercel Deploy Hook for the Web app.
# Usage:
#   scripts/deploy-web.sh [DEPLOY_HOOK_URL]
#
# The deploy hook URL can be provided via the first argument or the
# VERCEL_WEB_DEPLOY_HOOK_URL environment variable.

HOOK_URL=${1:-${VERCEL_WEB_DEPLOY_HOOK_URL:-}}

if [[ -z "${HOOK_URL}" ]]; then
  echo "Error: Deploy hook URL not provided."
  echo "Provide it as an argument or via VERCEL_WEB_DEPLOY_HOOK_URL env var."
  exit 1
fi

echo "Triggering Web deploy via Vercel Deploy Hook..."
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${HOOK_URL}")

if [[ "${http_code}" != "200" && "${http_code}" != "201" && "${http_code}" != "202" ]]; then
  echo "Deploy hook call failed with HTTP ${http_code}."
  exit 1
fi

echo "Deploy hook triggered (HTTP ${http_code}). Check Vercel for build status."
