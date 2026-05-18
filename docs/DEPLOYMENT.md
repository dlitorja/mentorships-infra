# Deployment Guidance

This repo is a monorepo with multiple apps:
- apps/web
- apps/platform
- apps/marketing

## CI (GitHub Actions)

- CI builds only the apps affected by a PR using a paths filter.
- Marketing build is optional (non-blocking) to reduce noise.

## Vercel Ignored Build Step (Recommended)

Configure per-project in Vercel → Settings → Build & Deployment → Ignored Build Step.

Use the `scripts/ignored-build-step.sh` script to skip builds when no relevant files changed:

1. Enable System Environment Variables (so `VERCEL_GIT_PREVIOUS_SHA` is available).
2. Set Ignored Build Step to run: `scripts/ignored-build-step.sh`
3. Provide `FOLDERS` env var per project:
   - Web: `FOLDERS="apps/web packages convex"`
   - Platform: `FOLDERS="apps/platform packages convex"`
   - Marketing: `FOLDERS="apps/marketing packages"`

Behavior:
- If any changed file is inside one of the specified folders, the script exits `1` (build continues).
- Otherwise it exits `0` and Vercel cancels the build.

## Notes

- For PRs that touch shared `packages/` or `convex/` code, both Web and Platform should build.
- Keep PRs scoped to one app when possible to reduce cross-app build triggers.
