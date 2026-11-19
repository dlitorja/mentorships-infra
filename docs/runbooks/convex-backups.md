# Convex database backups → B2

## Why

Managed Convex on the **Starter** plan has no dashboard backups (daily
backups are a Professional entitlement). On 2026-11-14 a retention-query
bug hard-deleted every workspace's chat, images, notes, and links. B2
still held the image/file blobs and the upload ledger, so attachments
were reconstructable — but plain-text messages, notes, and links had no
copy anywhere. This runbook covers the replacement: a daily export of
every Convex table to B2.

## What runs

| | |
|---|---|
| Trigger task | `convex-database-backup` (`src/trigger/convex-backup.ts`) |
| Schedule | `0 2 * * *` UTC, daily |
| Output | `convex-backups/<deployment>/<YYYY>/<MM>/<DD>/<timestamp>.zip` |
| Sidecar | same path, `.manifest.json` (size, sha256, deployment, run id) |
| Bucket | `WORKSPACE_STORAGE_BUCKET_NAME` (currently `mentorship-workspace-storage`) |
| Retention | 90 daily copies, always keeping the newest 7 per deployment |
| Contents | **Documents only.** File bytes stay in B2 (`fileUploads` ledger). |

Keys are immutable and timestamped, so a failed or partial run never
overwrites an existing backup.

The retention sweep deletes object **versions**, not keys. B2 buckets are
versioned by default; `DeleteObject` without a `VersionId` only adds a
hide marker and keeps billing the bytes.

## Required Trigger environment

| Variable | Source |
|---|---|
| `CONVEX_DEPLOY_KEY` | Deployment admin key — `convex export` needs admin access; Convex has no read-only deploy key. Synced from `.env.local`/CI by `trigger.config.ts` when present. Never log it. |
| `NEXT_PUBLIC_CONVEX_URL` | Derives the deployment name used in the key path. |
| `WORKSPACE_STORAGE_BUCKET_NAME` | Backup bucket (already used by workspace exports). |
| `B2_KEY_ID`, `B2_APPLICATION_KEY` | B2 credentials. |
| `B2_REGION` / `WORKSPACE_STORAGE_BUCKET_REGION` | Defaults to `us-east-005`. |
| `CONVEX_BACKUP_ALERT_EMAIL` | Optional. Failure alerts go here via Resend. |

The task is built with `additionalPackages({ packages: ["convex@1.50.0"] })`
so the CLI exists in the Trigger image. Bump that pin together with
`convex` in `package.json` (`scripts/check-convex-version.mjs` enforces
one version in the workspace).

If the Trigger environment is ever compromised, rotate the Convex deploy
key (dashboard → deployment → Settings → Deploy Keys) and redeploy.

## Verify a backup

1. Trigger dashboard → `convex-database-backup` → latest run. It must
   end `COMPLETED` and return `{ key, sizeBytes, sha256, deletedVersions }`.
2. List what is stored:

   ```bash
   node scripts/restore-convex-backup.mjs --list
   ```

3. Download and verify the checksum:

   ```bash
   node scripts/restore-convex-backup.mjs \
     --download convex-backups/fine-bulldog-260/2026/11/19/20261119T020000000Z.zip \
     --out /tmp/opencode/convex-backup \
     --verify
   ```

A successful run with `sizeBytes === 0` is impossible (the task throws),
but a suspiciously small ZIP compared with the previous day is worth
investigating before trusting it.

## Restore procedure

**Never restore in place first.** A restore replaces table contents and
would erase everything written after the backup.

### Drill or disaster recovery

1. Create a fresh preview deployment (Convex dashboard → Deployments →
   Create Preview), or use an existing empty preview.
2. Import the archive into the preview:

   ```bash
   npx convex import \
     --deployment <preview-deployment> \
     --replace-all /tmp/opencode/convex-backup/<timestamp>.zip
   ```

3. Verify in the preview: open the data page and check
   `workspaceMessages`, `workspaces`, `sessions` row counts against the
   manifest date. For this incident specifically, confirm
   `workspaceMessages` has rows older than the deletion window.
4. Only after verification, restore **one table at a time** into
   production with `--append` (never `--replace-all`):

   ```bash
   npx convex export --deployment <preview-deployment> --path /tmp/preview
   # unzip, then for a single table (always name the destination
   # explicitly; a logged-in CLI defaults to the dev deployment):
   npx convex import --deployment production \
     --table workspaceMessages --append \
     /tmp/preview/workspaceMessages/documents.jsonl
   ```

5. Re-run post-merge verification for anything that reads the restored
   tables (workspace chat, gallery, notes, links).

### Quarterly restore drill

Run steps 1–3 against the newest backup, record the row counts and the
time taken in the Linear verification issue, then delete the preview.
Do not skip the drill: an untested backup is a hypothesis.

## Troubleshooting

| Symptom | Check |
|---|---|
| `CONVEX_DEPLOY_KEY is not set` | Trigger env; `trigger.config.ts` only syncs it when the deploying machine has it locally. |
| `convex: command not found` | `additionalPackages` pin in `trigger.config.ts`; redeploy Trigger. |
| `WORKSPACE_STORAGE_BUCKET_NAME is not set` | The bucket env block is opt-in (`SYNC_BUCKET_ENV_TO_TRIGGER=1`) during deploy; otherwise set it in the Trigger dashboard. |
| Task times out | Export is slow on large deployments; raise `maxDuration` or move to a dedicated class. Current scale is a few MB. |
| Old backups remain on the bill | Check that the sweep deletes object versions; verify with `--list` and B2's file-version view. |

## Cost

Current production export is a few MB. 90 daily copies are well under
1 GB in B2; storage cost is cents per month. `convex export` itself is
covered by the Convex plan and does not write to the deployment.
