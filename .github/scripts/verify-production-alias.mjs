#!/usr/bin/env node
/**
 * Assert that each project's production domain is actually serving the commit
 * that just passed CI — and promote the deployment when it is not.
 *
 * Why this exists
 * ---------------
 * `deploy-on-main` skips the deploy hook when a production-target deployment
 * already exists for the SHA (the GitHub integration creates one on every push).
 * Nothing verified that the *custom domain* moved with it. On 2026-11-16 the
 * platform domain stayed pinned to `0105e59b` for eight hours while four newer
 * deployments sat READY, so a merged fix was never live and the admin UI kept
 * showing the old bug. A green pipeline looked identical to a successful deploy.
 *
 * Behaviour, per project/alias pair:
 *   1. Wait for a READY production deployment whose git SHA is the target SHA.
 *   2. Read the alias' current deployment; if it is that deployment, done.
 *   3. Otherwise promote the deployment, then poll the alias until it matches.
 *   4. Still mismatched after the poll budget → exit non-zero.
 *
 * Usage:
 *   VERCEL_TOKEN=… node .github/scripts/verify-production-alias.mjs \
 *     --sha <commit> --team <team_id> \
 *     --project prj_x --alias dev.example.com \
 *     --project prj_y --alias example.com
 */

const API = "https://api.vercel.com";

export function parseArgs(argv) {
  const targets = [];
  let pending = null;
  let sha = "";
  let team = "";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sha") sha = argv[++i] ?? "";
    else if (arg === "--team") team = argv[++i] ?? "";
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--project") pending = { project: argv[++i] ?? "", alias: "" };
    else if (arg === "--alias") {
      if (!pending) throw new Error("--alias must follow --project");
      pending.alias = argv[++i] ?? "";
      if (!pending.project || !pending.alias) {
        throw new Error("--project and --alias must both be non-empty");
      }
      targets.push(pending);
      pending = null;
    } else if (arg.trim() !== "") {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (pending) throw new Error("--project requires a following --alias");
  if (!sha) throw new Error("--sha is required");
  if (targets.length === 0) throw new Error("At least one --project/--alias pair is required");

  return { sha, team, targets, dryRun };
}

function url(path, team) {
  return `${API}${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}`;
}

async function vercelFetch(fetchImpl, token, path, team, init = {}) {
  const response = await fetchImpl(url(path, team), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status} ${text.slice(0, 200)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Promotion and similar endpoints can answer 200 with a non-JSON body.
    return null;
  }
}

/** Newest READY production deployment for the given commit, or null. */
async function findReadyDeployment({ fetchImpl, token, team, project, sha }) {
  const data = await vercelFetch(
    fetchImpl,
    token,
    `/v6/deployments?projectId=${encodeURIComponent(project)}&target=production&sha=${encodeURIComponent(sha)}&limit=20`,
    team
  );
  const deployments = Array.isArray(data?.deployments) ? data.deployments : [];
  // `/v6/deployments` list items expose `uid`; other endpoints use `id`.
  const ready = deployments
    .map((d) => ({ ...d, id: d?.uid ?? d?.id }))
    .filter((d) => (d?.readyState === "READY" || d?.state === "READY") && typeof d.id === "string")
    .sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));
  return ready[0] ?? null;
}

async function deploymentInfo({ fetchImpl, token, team, deploymentId }) {
  const data = await vercelFetch(
    fetchImpl,
    token,
    `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    team
  );
  return {
    sha: data?.meta?.githubCommitSha ?? "",
    createdAt: typeof data?.createdAt === "number" ? data.createdAt : null,
  };
}

/** Deployment currently behind the alias, or null when the alias is unknown. */
async function aliasDeploymentId({ fetchImpl, token, team, alias }) {
  try {
    const data = await vercelFetch(fetchImpl, token, `/v4/aliases/${encodeURIComponent(alias)}`, team);
    // The API returns `{ alias: "<hostname>", deploymentId: "dpl_…", … }`;
    // older shapes nest the record under `alias`.
    if (typeof data?.deploymentId === "string") return data.deploymentId;
    const record = typeof data?.alias === "object" && data.alias !== null ? data.alias : null;
    return record?.deploymentId ?? record?.deployment?.id ?? null;
  } catch (error) {
    if (/→ 404\b/.test(String(error?.message))) return null;
    throw error;
  }
}

async function promote({ fetchImpl, token, team, project, deploymentId }) {
  await vercelFetch(
    fetchImpl,
    token,
    `/v10/projects/${encodeURIComponent(project)}/promote/${encodeURIComponent(deploymentId)}`,
    team,
    { method: "POST", body: JSON.stringify({}) }
  );
}

/**
 * Resolve one target. Returns a result object; throws only on unrecoverable
 * API errors. `ok === false` means the alias never reached the commit.
 */
export async function verifyTarget({
  fetchImpl = fetch,
  token,
  team,
  project,
  alias,
  sha,
  dryRun = false,
  timeoutMs = 10 * 60_000,
  pollMs = 15_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
  now = () => Date.now(),
}) {
  const deadline = now() + timeoutMs;

  let deployment = null;
  while (now() < deadline) {
    deployment = await findReadyDeployment({ fetchImpl, token, team, project, sha });
    if (deployment) break;
    log(`${alias}: no READY deployment for ${sha.slice(0, 7)} yet; waiting ${pollMs}ms`);
    await sleep(pollMs);
  }

  if (!deployment) {
    return { alias, project, ok: false, reason: "no READY production deployment for this commit" };
  }

  let currentId = await aliasDeploymentId({ fetchImpl, token, team, alias });
  const current = currentId
    ? await deploymentInfo({ fetchImpl, token, team, deploymentId: currentId })
    : { sha: "", createdAt: null };

  if (currentId === deployment.id && current.sha === sha) {
    return { alias, project, ok: true, promoted: false, deploymentId: deployment.id };
  }

  // Never move production backwards. Re-running CI for an older commit, or a
  // delayed run, must not roll the domain back to a superseded deployment, so
  // promotion is only allowed when the candidate is at least as new as what the
  // alias already serves. This needs no external lookup, so a flaky GitHub API
  // cannot silently disable the guard.
  const candidateCreatedAt = typeof deployment.createdAt === "number" ? deployment.createdAt : null;
  if (
    current.createdAt !== null &&
    candidateCreatedAt !== null &&
    candidateCreatedAt <= current.createdAt
  ) {
    log(
      `${alias}: already serving a newer deployment (${current.sha ? current.sha.slice(0, 7) : currentId}); refusing to roll back to ${sha.slice(0, 7)}`
    );
    return {
      alias,
      project,
      ok: true,
      promoted: false,
      skipped: true,
      reason: "alias already serves a newer deployment",
      deploymentId: currentId,
    };
  }

  log(
    `${alias}: serving ${current.sha ? current.sha.slice(0, 7) : "nothing"}, expected ${sha.slice(0, 7)}`
  );
  if (dryRun) {
    return {
      alias,
      project,
      ok: false,
      promoted: false,
      dryRun: true,
      reason: `alias is stale; would promote ${deployment.id}`,
    };
  }
  log(`${alias}: promoting ${deployment.id}`);
  await promote({ fetchImpl, token, team, project, deploymentId: deployment.id });

  // Alias updates are eventually consistent; poll briefly before failing.
  const promoteDeadline = now() + Math.min(timeoutMs, 2 * 60_000);
  while (now() < promoteDeadline) {
    currentId = await aliasDeploymentId({ fetchImpl, token, team, alias });
    if (currentId === deployment.id) {
      return { alias, project, ok: true, promoted: true, deploymentId: deployment.id };
    }
    await sleep(pollMs);
  }

  return {
    alias,
    project,
    ok: false,
    promoted: true,
    reason: `alias still points at ${currentId ?? "nothing"} after promotion`,
  };
}

async function main() {
  const token = process.env.VERCEL_TOKEN;
  const args = parseArgs(process.argv.slice(2));

  if (!token) {
    // Never fail a merge because the token is absent in a fork; surface it.
    console.log("::warning::VERCEL_TOKEN is not set; skipping production alias verification");
    return 0;
  }
  if (!args.team) {
    console.log("::warning::VERCEL_ORG_ID is not set; skipping production alias verification");
    return 0;
  }

  const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS ?? 10 * 60_000);
  const pollMs = Number(process.env.VERIFY_POLL_MS ?? 15_000);

  const results = [];
  for (const target of args.targets) {
    const result = await verifyTarget({
      token,
      team: args.team,
      project: target.project,
      alias: target.alias,
      sha: args.sha,
      dryRun: args.dryRun,
      timeoutMs,
      pollMs,
      log: (message) => console.log(message),
    });
    results.push(result);
  }

  let failed = false;
  for (const result of results) {
    if (result.ok) {
      const action = result.promoted
        ? "promoted to"
        : result.skipped
          ? `left alone (serves a newer deployment); nothing to do for`
          : "already serving";
      console.log(`✅ ${result.alias}: ${action} ${args.sha.slice(0, 7)}`);
    } else {
      failed = true;
      console.log(
        `::error::${result.alias} is NOT serving ${args.sha.slice(0, 7)} — ${result.reason}`
      );
    }
  }

  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1]?.endsWith("verify-production-alias.mjs");
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`::error::${error?.message ?? error}`);
      process.exit(1);
    });
}
