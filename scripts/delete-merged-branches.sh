#!/bin/bash
set -euo pipefail

# Delete merged branches that are protected and can't be deleted via git push --delete

BRANCHES=(
  "deploy/fix-admin-inventory"
  "feature/fix-deploy-hook"
  "fix/convex-http-migration-v2"
  "fix/post-purchase-email-flow"
  "fix/pr-review-feedback"
  "fix/vercel-json"
  "redeploy-fix-0"
)

for branch in "${BRANCHES[@]}"; do
  echo "Deleting refs/heads/$branch..."
  gh api repos/:owner/:repo/git/refs/heads/$branch --method DELETE 2>&1 && echo "Deleted $branch" || echo "Failed to delete $branch (may be protected or already deleted)"
done
