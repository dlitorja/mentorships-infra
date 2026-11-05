#!/usr/bin/env node
/**
 * Triage Vercel Agent Security Review findings into Linear.
 *
 * Security Review files findings in the Vercel Vulnerabilities dashboard and adds a
 * check to each reviewed commit, but nothing notifies the team when a Critical or High
 * finding lands. This script closes that loop on demand: it pulls the open findings,
 * filters by severity, dedupes against Linear, and (with --apply) opens one issue per
 * new finding with the triage steps from docs/security/vercel-security-review.md §5.
 *
 * Deliberately NOT wired into CI. This repository is public, and
 * `vercel security vulnerabilities` prints source snippets and security posture;
 * public Actions logs and artifacts are readable by anyone. Run it locally, or have an
 * agent run it, never from a workflow. See AGENTS.md §"Vercel Security Review".
 *
 * Usage:
 *   node scripts/security-review-triage.mjs                    # dry run, high and critical
 *   node scripts/security-review-triage.mjs --min-severity critical
 *   node scripts/security-review-triage.mjs --apply            # create Linear issues
 *   node scripts/security-review-triage.mjs --from-file /tmp/opencode/findings.json
 *
 * Flags:
 *   --apply                 Create Linear issues (default is a dry run).
 *   --min-severity <level>  critical | high | medium | low (default: high).
 *   --scope <team>          Vercel team slug or ID (default: $VERCEL_SCOPE, then the
 *                           mentorships team slug).
 *   --team <key>            Linear team key (default: HUC).
 *   --project <id>          Vercel project name/ID to filter on (optional).
 *   --from-file <path>      Read a saved `vercel security vulnerabilities --json` payload
 *                           instead of calling the CLI. For testing the triage logic.
 *   --vercel-bin <path>     Vercel CLI binary (default: `npx vercel@latest`).
 *   --with-details          Include the finding description and suggested fix in the Linear
 *                           issue. One extra `inspect --json` call per finding, and off by
 *                           default: those fields can quote source. (`--json` listing strips
 *                           them, so they cannot come from the list call.)
 *   --no-dedupe             Create issues without checking Linear first. Debugging only.
 *   --json                  Print the machine-readable summary instead of the table.
 *   --help                  Show this help.
 *
 * Env:
 *   VERCEL_SCOPE     Default Vercel team scope.
 *   LINEAR_TEAM      Default Linear team key.
 */

import { execFile, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
// Override for offline tests: a stub that mimics `issues` / `create-issue`.
const LINEAR_CLI = process.env.LINEAR_CLI_PATH ?? join(SCRIPT_DIR, "linear-cli.mjs");

const DEFAULT_SCOPE = "dustin-litorjas-projects-95e47775";
const DEFAULT_TEAM = "HUC";
const MARKER = "security-review-ref";
const MAX_CHARS = 1500;

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const PRIORITY = { critical: 1, high: 2, medium: 3, low: 4 };

const COLOR = process.env.NO_COLOR
  ? null
  : {
      reset: "\x1b[0m",
      dim: "\x1b[2m",
      bold: "\x1b[1m",
      red: "\x1b[31m",
      yellow: "\x1b[33m",
      green: "\x1b[32m",
    };

function paint(color, text) {
  return COLOR ? `${COLOR[color]}${text}${COLOR.reset}` : text;
}

function help() {
  return [
    "Triage Vercel Security Review findings into Linear.",
    "",
    "Usage: node scripts/security-review-triage.mjs [flags]",
    "",
    "  --apply                 Create Linear issues (default: dry run)",
    "  --min-severity <level>  critical | high | medium | low (default: high)",
    "  --scope <team>          Vercel team slug/ID (default: $VERCEL_SCOPE or the mentorships team)",
    "  --team <key>            Linear team key (default: HUC)",
    "  --project <name>        Only findings for this Vercel project",
    "  --from-file <path>      Read a saved vulnerabilities --json payload instead of calling the CLI",
    "  --vercel-bin <path>     Vercel CLI binary (default: npx vercel@latest)",
    "  --with-details          Include description + suggested fix (inspect call per finding; may quote source)",
    "  --no-dedupe             Skip the Linear dedupe check (debugging only)",
    "  --json                  Print the machine-readable summary",
    "  --help                  Show this help",
    "",
    "Runbook: docs/security/vercel-security-review.md §5",
  ].join("\n");
}

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      flags.apply = true;
    } else if (arg === "--with-details") {
      flags.withDetails = true;
    } else if (arg === "--no-dedupe") {
      flags.noDedupe = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Flag --${arg.slice(2)} needs a value`);
      }
      flags[key] = next;
      i++;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function pick(object, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc?.[part], object);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function truncate(text, max = MAX_CHARS) {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/**
 * Normalise one finding.
 *
 * Shape confirmed against the installed CLI (`vercel@65.11.0`, dist/commands-core.js):
 * `--json` prints `{ vulnerabilities, repositories, pagination: { next } }`, where each
 * vulnerability is the full finding minus `description` and `fix` (those are stripped and only
 * available from `inspect --json`). Identity is `findingId` (a ULID) plus the derived reference
 * `<targetName>/<number>`, which is what `toReference()` builds for the CLI's own output:
 *
 *   function toReference(names, { target, number }) {
 *     return `${names.get(target.id) ?? target.id}/${number}`;
 *   }
 *
 * `names` comes from `repositories` (id -> name) and, on the CLI, a project lookup fallback.
 * We cannot do that lookup cheaply, so an unmatched target id is used verbatim as the project
 * segment — never silently replaced with "unknown", which would collapse distinct findings into
 * one dedupe key.
 */
export function normalizeFinding(raw, index, repositories) {
  const target = raw.target ?? {};
  const targetName = repositories.get(target.id) ?? target.name ?? target.id ?? undefined;
  const number = raw.number;
  const reference =
    raw.reference ??
    (targetName && number !== undefined && number !== null ? `${targetName}/${number}` : undefined) ??
    raw.findingId;

  if (!reference) {
    throw new Error(
      `Finding ${index + 1} has no reference, findingId, or target/number, so it cannot be ` +
        `deduped safely. Keys present: ${Object.keys(raw).join(", ") || "(none)"}. ` +
        `Re-check the payload shape against the installed CLI before running with --apply.`
    );
  }

  const findingId = raw.findingId ? String(raw.findingId) : undefined;

  return {
    reference: String(reference),
    findingId,
    project: String(targetName ?? "unknown"),
    title: String(pick(raw, ["title", "name", "vulnerabilityClass", "class"]) ?? `Finding ${index + 1}`),
    severity: String(pick(raw, ["severity", "risk"]) ?? "unknown").toLowerCase(),
    status: String(pick(raw, ["status", "state"]) ?? "open").toLowerCase(),
    vulnerabilityClass: pick(raw, ["vulnerabilityClass", "class"]),
    environment: pick(raw, ["environment"]),
    branch: pick(raw, ["branchRef", "branch", "gitBranch"]),
    summary: truncate(pick(raw, ["summary"])),
    description: truncate(pick(raw, ["description"]), 4000),
    fix: truncate(pick(raw, ["fix", "suggestedFix", "suggestion"])),
    url: pick(raw, ["url", "permalink", "dashboardUrl"]),
    dashboardPath: findingId ? `~/security/vulnerabilities/${findingId}` : undefined,
    raw,
  };
}

export function rank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * A saved payload may be a single page, an array of pages, or (the original, still-supported
 * form) a bare array of findings. Treating every array as pages silently dropped findings —
 * `extractPage()` on a finding returns an empty list, so the run reported "nothing to triage".
 */
function isPagePayload(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Array.isArray(value.vulnerabilities) ||
      Array.isArray(value.findings) ||
      Array.isArray(value.data))
  );
}

export function toPages(payload) {
  if (!Array.isArray(payload)) return [payload];
  if (payload.length > 0 && payload.every(isPagePayload)) return payload;
  return [{ vulnerabilities: payload }];
}

export function extractPage(payload) {
  const list =
    (Array.isArray(payload?.vulnerabilities) && payload.vulnerabilities) ||
    (Array.isArray(payload?.findings) && payload.findings) ||
    (Array.isArray(payload?.data) && payload.data) ||
    (Array.isArray(payload) && payload) ||
    [];

  const repositories = new Map();
  for (const repository of payload?.repositories ?? []) {
    if (repository?.id && repository?.name) repositories.set(repository.id, repository.name);
  }

  return {
    list: list.filter((item) => item && typeof item === "object"),
    repositories,
    next: payload?.pagination?.next ?? payload?.nextCursor ?? null,
  };
}

const MAX_PAGES = 20;

/**
 * Fetch every page of findings.
 *
 * The CLI prints `pagination.next` and accepts `--next <cursor>`; the default page size is 20.
 * Ignoring the cursor silently caps triage at the first page, so later High/Critical findings
 * would never be tracked — the failure mode is invisible, which is why this loops rather than
 * trusting a single call.
 */
async function fetchFindings(flags) {
  const scope = flags.scope ?? process.env.VERCEL_SCOPE ?? DEFAULT_SCOPE;

  if (flags.fromFile) {
    const payload = JSON.parse(await readFile(flags.fromFile, "utf8"));
    const pages = toPages(payload);
    const repositories = new Map();
    const raw = [];
    for (const page of pages) {
      const extracted = extractPage(page);
      for (const [id, name] of extracted.repositories) repositories.set(id, name);
      raw.push(...extracted.list);
    }
    return {
      findings: raw.map((item, index) => normalizeFinding(item, index, repositories)),
      source: `file:${flags.fromFile}`,
      scope,
      pages: pages.length,
    };
  }

  const minSeverity = (flags.minSeverity ?? "high").toLowerCase();
  const severities = Object.keys(SEVERITY_RANK)
    .filter((level) => rank(level) >= rank(minSeverity))
    .join(",");

  const baseArgs = ["security", "vulnerabilities", "--json", "--scope", scope, "--severity", severities, "--limit", "100"];
  if (flags.project) baseArgs.push("--project", flags.project);

  const repositories = new Map();
  const raw = [];
  let cursor = null;
  let pages = 0;

  do {
    const args = cursor ? [...baseArgs, "--next", cursor] : baseArgs;
    const payload = parseVercelJson(runVercel(flags, args), args);
    const page = extractPage(payload);
    for (const [id, name] of page.repositories) repositories.set(id, name);
    raw.push(...page.list);
    cursor = page.next ?? null;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  if (cursor) {
    throw new Error(
      `Stopped after ${MAX_PAGES} pages with a cursor still pending. Triage is incomplete; ` +
        `raise MAX_PAGES or narrow with --project/--severity.`
    );
  }

  return {
    findings: raw.map((item, index) => normalizeFinding(item, index, repositories)),
    source: `vercel:${scope}`,
    scope,
    pages,
  };
}

function resolveVercel(flags) {
  if (flags.vercelBin) return { command: flags.vercelBin, commandArgs: [] };
  return { command: "npx", commandArgs: ["--yes", "vercel@latest"] };
}

function runVercel(flags, args) {
  const { command, commandArgs } = resolveVercel(flags);
  try {
    const result = spawnSync(command, [...commandArgs, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").toString().trim();
      throw new Error(
        `Vercel CLI failed (${command} ${args.join(" ")}).\n${detail}\n\n` +
          "If this says Security Review is not enabled, check the team scope in Settings → Agent.\n" +
          "If it says the team is wrong, pass --scope <slug>."
      );
    }
    return result.stdout;
  } catch (error) {
    if (error.message?.startsWith("Vercel CLI failed")) throw error;
    throw new Error(`Could not run the Vercel CLI (${command}): ${error.message}`);
  }
}

function parseVercelJson(stdout, args) {
  // The CLI may emit banner lines before the JSON object.
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(
      `Could not find a JSON payload in the output of ${args.join(" ")}:\n${stdout.slice(0, 400)}`
    );
  }
  try {
    return JSON.parse(stdout.slice(start));
  } catch (error) {
    throw new Error(`Vercel CLI returned unparseable JSON for ${args.join(" ")}: ${error.message}`);
  }
}

/**
 * `--json` deliberately strips `description` and `fix` (see the CLI's list handler), so detail
 * can only come from `inspect --json`. One extra call per finding, opt-in.
 */
function fetchDetail(finding, flags) {
  if (!finding.findingId) return null;
  const scope = flags.scope ?? process.env.VERCEL_SCOPE ?? DEFAULT_SCOPE;
  const args = ["security", "vulnerabilities", "inspect", finding.findingId, "--json", "--scope", scope];
  const payload = parseVercelJson(runVercel(flags, args), args);
  const detail = payload?.vulnerability ?? payload;
  return {
    description: truncate(detail?.description, 4000),
    fix: truncate(detail?.fix, 4000),
  };
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

/**
 * Call the Linear wrapper and insist on a usable answer.
 *
 * A wrapper/tool failure can arrive as successful stdout containing a `{ status: "error" }`
 * envelope, or as unparseable text. Treating either as "no results" would silently turn a broken
 * dedupe lookup into "no match" (duplicate issues) and a rejected creation into a reported
 * success, so both are hard errors here.
 */
async function linear(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [LINEAR_CLI, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    }));
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message || "").toString().trim();
    throw new Error(`linear ${args[0]} failed: ${detail || "no output"}`);
  }

  return interpretLinearOutput(args[0], stdout);
}

/**
 * Reject anything we cannot act on. A tool failure can arrive as `{ status: "error" }` on a
 * zero exit code, and a wrapper that prints prose would otherwise parse as "no results" —
 * which turns a broken dedupe lookup into "no match" and a rejected creation into success.
 */
export function interpretLinearOutput(command, stdout) {
  const parsed = parseJsonEnvelope(stdout);
  if (parsed === undefined) {
    throw new Error(
      `linear ${command} returned unreadable output, refusing to guess: ${String(stdout).slice(0, 300)}`
    );
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.status === "error") {
    throw new Error(
      `linear ${command} reported an error: ${parsed.message ?? JSON.stringify(parsed).slice(0, 300)}`
    );
  }
  return parsed;
}

export function pickIdentifier(created) {
  const identifier = pick(created ?? {}, ["identifier", "issue.identifier", "id", "issue.id"]);
  if (identifier === undefined || identifier === null || identifier === "") return undefined;
  return String(identifier);
}

function parseJsonEnvelope(stdout) {
  const brace = stdout.indexOf("{");
  const bracket = stdout.indexOf("[");
  const candidates = [brace, bracket].filter((index) => index !== -1);
  if (candidates.length === 0) return undefined;
  const from = Math.min(...candidates);
  try {
    return JSON.parse(stdout.slice(from));
  } catch {
    return undefined;
  }
}

function linearIssues(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.issues)) return payload.issues;
  if (Array.isArray(payload?.nodes)) return payload.nodes;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function markerFor(reference) {
  return `${MARKER}: ${reference}`;
}

// Capture the whole reference token, stopping before the comment terminator. Matching the
// complete token (not a prefix) matters: `platform/1` is a different finding from `platform/12`,
// and a prefix match would mark the second as already tracked and never file it.
const REFERENCE_PATTERN = /security-review-ref:\s*([^\s>]+)/g;

export function referencesIn(issue) {
  const text = `${issue?.title ?? ""}\n${issue?.description ?? ""}`;
  return [...text.matchAll(REFERENCE_PATTERN)].map((match) => match[1]);
}

export function issueCarriesFinding(issue, reference) {
  return referencesIn(issue).includes(reference);
}

async function findExistingIssue(team, reference) {
  const searched = await linear(["issues", "--team", team, "--query", reference, "--limit", "25"]);
  if (linearIssues(searched).some((issue) => issueCarriesFinding(issue, reference))) {
    return true;
  }

  // Fallback: the keyword search may be ignored by the MCP tool. Scan recent issues for the
  // marker directly, so a dedupe miss cannot create a duplicate issue.
  const recent = await linear(["issues", "--team", team, "--limit", "100"]);
  return linearIssues(recent).some((issue) => issueCarriesFinding(issue, reference));
}

function dashboardLink(finding, flags) {
  if (finding.url) return finding.url;
  if (!finding.dashboardPath) return undefined;
  const scope = flags.scope ?? process.env.VERCEL_SCOPE ?? DEFAULT_SCOPE;
  return `https://vercel.com/${scope}/${finding.dashboardPath}`;
}

export function buildIssue(finding, flags) {
  const lines = [
    `<!-- ${markerFor(finding.reference)} -->`,
    "",
    `**Severity:** ${finding.severity} · **Vercel target:** ${finding.project}` +
      (finding.environment ? ` · **Environment:** ${finding.environment}` : "") +
      (finding.branch ? ` · **Branch:** ${finding.branch}` : "") +
      (finding.vulnerabilityClass ? ` · **Class:** ${finding.vulnerabilityClass}` : ""),
    finding.findingId ? `**Vercel finding id:** \`${finding.findingId}\`` : undefined,
    "",
    finding.summary ?? "See the Vulnerabilities dashboard for the summary.",
    "",
  ].filter((line) => line !== undefined);

  if (flags.withDetails) {
    if (finding.description) lines.push("**Details**", "", finding.description, "");
    if (finding.fix) lines.push("**Suggested fix (from Vercel Agent)**", "", finding.fix, "");
  }

  const link = dashboardLink(finding, flags);
  lines.push(
    "**Where to look:** Vercel → team → Security → Vulnerabilities" +
      (link ? ` (${link})` : `, finding \`${finding.reference}\``),
    "",
    "**Triage** (`docs/security/vercel-security-review.md` §5):",
    "- Treat this as an estimate, not a score. Confirm the finding against our own threat model before spending a week on it.",
    "- Fix on a topic branch through the normal gates (Greptile + CodeRabbit). Schema changes follow widen–migrate–narrow.",
    "- Or dismiss in the dashboard: `vercel security vulnerabilities dismiss " +
      finding.reference +
      " --reason false-positive|accepted-risk --message \"...\"`, then note the reason here.",
    "- A finding that needs a Clerk change is report-only; do not edit Clerk config without explicit approval.",
    "",
    "Close this issue when the fix PR merges **and** a later review stops reporting the finding.",
    "",
    `<sub>Opened by scripts/security-review-triage.mjs. Do not paste this content onto a public surface.</sub>`
  );

  const title = `Security Review: ${finding.severity} — ${finding.title} (${finding.project})`;
  return { title: title.slice(0, 250), description: lines.join("\n") };
}

async function reconcile(findings, flags) {
  const team = flags.team ?? process.env.LINEAR_TEAM ?? DEFAULT_TEAM;
  const results = [];

  for (const finding of findings) {
    const existing = flags.noDedupe ? false : await findExistingIssue(team, finding.reference);
    if (existing) {
      results.push({ finding, action: "skip-existing" });
      continue;
    }

    if (!flags.apply) {
      results.push({ finding, action: "would-create" });
      continue;
    }

    if (flags.withDetails) {
      try {
        Object.assign(finding, fetchDetail(finding, flags) ?? {});
      } catch (error) {
        console.error(`[warn] could not fetch details for ${finding.reference}: ${error.message}`);
      }
    }

    const { title, description } = buildIssue(finding, flags);
    const created = await linear([
      "create-issue",
      "--team",
      team,
      "--title",
      title,
      "--description",
      description,
      "--priority",
      String(PRIORITY[finding.severity] ?? 3),
    ]);

    const identifier = pickIdentifier(created);
    if (!identifier) {
      throw new Error(
        `Linear accepted create-issue for ${finding.reference} but returned no identifier: ` +
          `${JSON.stringify(created)?.slice(0, 300)}. Treating this as a failure. ` +
          `Re-running is safe: anything already filed carries a ${MARKER} marker and is skipped.`
      );
    }

    results.push({ finding, action: "created", identifier });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printTable(results, meta) {
  const counts = results.reduce((acc, result) => {
    acc[result.action] = (acc[result.action] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `${paint("bold", "Vercel Security Review triage")} ${paint("dim", `(${meta.source}, min severity ${meta.minSeverity})`)}`
  );
  console.log("");

  if (results.length === 0) {
    console.log(paint("green", `No open findings at or above "${meta.minSeverity}".`));
    return counts;
  }

  for (const { finding, action, identifier } of results) {
    const severityColor = finding.severity === "critical" ? "red" : finding.severity === "high" ? "yellow" : "dim";
    const label =
      action === "created"
        ? paint("green", `created ${identifier ?? "issue"}`)
        : action === "skip-existing"
          ? paint("dim", "already tracked")
          : paint("yellow", "would create");
    console.log(
      `  ${paint(severityColor, finding.severity.padEnd(8))} ${finding.title} ${paint("dim", `(${finding.reference})`)} → ${label}`
    );
  }

  console.log("");
  const summary = [
    `${results.length} finding(s) at or above "${meta.minSeverity}"`,
    `${counts.created ?? 0} created`,
    `${counts["would-create"] ?? 0} pending`,
    `${counts["skip-existing"] ?? 0} already tracked`,
  ].join(" · ");
  console.log(summary);

  if (!meta.apply && (counts["would-create"] ?? 0) > 0) {
    console.log(paint("dim", "Dry run. Re-run with --apply to open Linear issues."));
  }
  return counts;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(help());
    return;
  }

  const minSeverity = (flags.minSeverity ?? "high").toLowerCase();
  if (!(minSeverity in SEVERITY_RANK)) {
    throw new Error(`--min-severity must be one of ${Object.keys(SEVERITY_RANK).join(", ")}`);
  }

  const { findings, source, scope, pages } = await fetchFindings({ ...flags, minSeverity });
  const actionable = findings.filter((finding) => rank(finding.severity) >= rank(minSeverity));
  const results = await reconcile(actionable, { ...flags, minSeverity });

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          source,
          scope,
          pages: pages ?? 1,
          fetched: findings.length,
          minSeverity,
          apply: Boolean(flags.apply),
          results: results.map(({ finding, action, identifier }) => ({
            reference: finding.reference,
            findingId: finding.findingId,
            project: finding.project,
            severity: finding.severity,
            title: finding.title,
            action,
            identifier,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  printTable(results, { source, minSeverity, apply: Boolean(flags.apply) });
}

// Only run when executed directly, so the pure helpers stay importable by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(paint("red", `Error: ${error.message}`));
    process.exit(1);
  });
}
