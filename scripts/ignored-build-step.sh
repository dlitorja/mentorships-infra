#!/usr/bin/env bash
set -euo pipefail

# Ignored Build Step script for Vercel
# Exits 0 to cancel build, 1 to continue build.
# Usage in Vercel Project Settings: Build & Deployment → Ignored Build Step → Run my Bash script
# Command: scripts/ignored-build-step.sh
# Optional: set FOLDERS env var to space-separated list of folders to watch.

prev_sha="${VERCEL_GIT_PREVIOUS_SHA:-}"
curr_sha="${VERCEL_GIT_COMMIT_SHA:-}"

# Default folders per project; override via FOLDERS env
folders_default="apps/web packages convex"
folders="${FOLDERS:-$folders_default}"

if [[ -z "$prev_sha" || -z "$curr_sha" ]]; then
  # No previous SHA available (first build or setting not enabled): build
  echo "No previous SHA provided; proceeding with build"
  exit 1
fi

# Ensure ref exists locally
git fetch --quiet origin "$prev_sha" || true

changed_files=$(git diff --name-only "$prev_sha" "$curr_sha" || true)

if [[ -z "$changed_files" ]]; then
  echo "No changes detected; canceling build"
  exit 0
fi

# Check if any changed file is under the watched folders
for file in $changed_files; do
  for folder in $folders; do
    if [[ "$file" == "$folder"/* ]]; then
      echo "Changes detected in $folder ($file); proceeding with build"
      exit 1
    fi
  done
done

echo "No changes in watched folders ($folders); canceling build"
exit 0
