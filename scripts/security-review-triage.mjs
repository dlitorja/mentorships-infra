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
 *   --vercel-bin <path>     Vercel CLI binary (default: `vercel` if on PATH, else `npx`).
 *   --with-details          Include the finding description and suggested fix in the
 *                           Linear issue. Off by default: those fields can quote source.
 *   --no-dedupe             Create issues without checking Linear first. Debugging only.
 *   --json                  Print the machine-readable summary instead of the table.
 *   --help                  Show this help.
 *
 * Env:
 *   VERCEL_SCOPE     Default Vercel team scope.
 *   LINEAR_TEAM      Default Linear team key.
 */

import { execFile } from "node:child_process";
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
    "  --with-details          Include description + suggested fix in the issue (may quote source)",
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
 * Normalise one finding. The exact API shape is not published and we had zero findings
 * to sample against, so every field goes through candidate keys and nothing is assumed
 * to exist. A finding without a stable reference still gets one, derived from project +
 * title, so dedupe does not silently break when the API renames a field.
 */
function normalizeFinding(raw, index) {
  const project =
    pick(raw, ["project.name", "projectName", "project.slug", "project"]) ?? "unknown-project";
  const title = pick(raw, ["title", "name", "vulnerabilityClass", "class"]) ?? `Finding ${index + 1}`;
  const severity = String(pick(raw, ["severity", "risk"]) ?? "unknown").toLowerCase();
  const reference =
    pick(raw, ["reference", "ref", "slug", "identifier", "key"]) ??
    `${project}/${slugify(title)}`;

  return {
    reference: String(reference),
    project: String(project),
    title: String(title),
    severity,
    status: String(pick(raw, ["status", "state"]) ?? "open").toLowerCase(),
    environment: pick(raw, ["environment", "env"]),
    branch: pick(raw, ["branch", "gitBranch", "git_branch"]),
    summary: truncate(pick(raw, ["summary", "shortDescription"])),
    description: truncate(pick(raw, ["description", "details", "detail"]), 4000),
    fix: truncate(pick(raw, ["fix", "suggestedFix", "suggestion", "fixSuggestion"]), 4000),
    url: pick(raw, ["url", "permalink", "dashboardUrl", "link"]),
    raw,
  };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function rank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

function extractFindings(payload) {
  const list =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.vulnerabilities) && payload.vulnerabilities) ||
    (Array.isArray(payload?.findings) && payload.findings) ||
    (Array.isArray(payload?.data) && payload.data) ||
    [];

  return list
    .filter((item) => item && typeof item === "object")
    .map((item, index) => normalizeFinding(item, index));
}

async function fetchFindings(flags) {
  if (flags.fromFile) {
    const payload = JSON.parse(await readFile(flags.fromFile, "utf8"));
    return { findings: extractFindings(payload), source: `file:${flags.fromFile}` };
  }

  const scope = flags.scope ?? process.env.VERCEL_SCOPE ?? DEFAULT_SCOPE;
  const minSeverity = (flags.minSeverity ?? "high").toLowerCase();
  const severities = Object.keys(SEVERITY_RANK)
    .filter((level) => rank(level) >= rank(minSeverity))
    .join(",");

  const args = ["security", "vulnerabilities", "--json", "--scope", scope, "--severity", severities];
  if (flags.project) args.push("--project", flags.project);

  const { command, commandArgs } = resolveVercel(flags);

  let stdout;
  try {
    ({ stdout } = await execFileAsync(command, [...commandArgs, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    }));
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message || "").toString().trim();
    throw new Error(
      `Vercel CLI failed (${command} ${args.join(" ")}).\n${detail}\n\n` +
        "If this says Security Review is not enabled, check the team scope in Settings → Agent.\n" +
        "If it says the team is wrong, pass --scope <slug>."
    );
  }

  // The CLI may emit banner lines before the JSON object.
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(`Could not find a JSON payload in the Vercel CLI output:\n${stdout.slice(0, 400)}`);
  }

  return {
    findings: extractFindings(JSON.parse(stdout.slice(start))),
    source: `vercel:${scope}`,
  };
}

function resolveVercel(flags) {
  if (flags.vercelBin) return { command: flags.vercelBin, commandArgs: [] };
  return { command: "npx", commandArgs: ["--yes", "vercel@latest"] };
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

async function linear(args) {
  const { stdout } = await execFileAsync(process.execPath, [LINEAR_CLI, ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const start = stdout.indexOf("{");
  const startArray = stdout.indexOf("[");
  const from = start === -1 ? startArray : startArray === -1 ? start : Math.min(start, startArray);
  if (from === -1) return null;
  try {
    return JSON.parse(stdout.slice(from));
  } catch {
    return null;
  }
}

function linearIssues(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.issues)) return payload.issues;
  if (Array.isArray(payload?.nodes)) return payload.nodes;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function markerFor(reference) {
  return `${MARKER}: ${reference}`;
}

function issueCarriesFinding(issue, reference) {
  const haystack = `${issue?.title ?? ""}\n${issue?.description ?? ""}`;
  return haystack.includes(markerFor(reference));
}

async function findExistingIssue(team, reference) {
  const searched = await linear(["issues", "--team", team, "--query", reference, "--limit", "25"]);
  if (linearIssues(searched).some((issue) => issueCarriesFinding(issue, reference))) {
    return true;
  }

  // Fallback: keyword search may be ignored by the MCP tool. Scan recent issues for the
  // marker directly, so a dedupe miss cannot create a duplicate issue.
  const recent = await linear(["issues", "--team", team, "--limit", "100"]);
  return linearIssues(recent).some((issue) => issueCarriesFinding(issue, reference));
}

function buildIssue(finding, flags) {
  const lines = [
    `<!-- ${markerFor(finding.reference)} -->`,
    "",
    `**Severity:** ${finding.severity} · **Vercel project:** ${finding.project}` +
      (finding.environment ? ` · **Environment:** ${finding.environment}` : "") +
      (finding.branch ? ` · **Branch:** ${finding.branch}` : ""),
    "",
    finding.summary ?? "See the Vulnerabilities dashboard for the summary.",
    "",
  ];

  if (flags.withDetails) {
    if (finding.description) lines.push("**Details**", "", finding.description, "");
    if (finding.fix) lines.push("**Suggested fix (from Vercel Agent)**", "", finding.fix, "");
  }

  lines.push(
    "**Where to look:** Vercel → team → Security → Vulnerabilities" +
      (finding.url ? ` (${finding.url})` : `, finding \`${finding.reference}\``),
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
    const identifier =
      pick(created ?? {}, ["identifier", "issue.identifier", "id"]) ??
      pick(created?.issue ?? {}, ["identifier", "id"]);
    results.push({ finding, action: "created", identifier: identifier ? String(identifier) : undefined });
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

  const { findings, source } = await fetchFindings({ ...flags, minSeverity });
  const actionable = findings.filter((finding) => rank(finding.severity) >= rank(minSeverity));
  const results = await reconcile(actionable, { ...flags, minSeverity });

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          source,
          minSeverity,
          apply: Boolean(flags.apply),
          results: results.map(({ finding, action, identifier }) => ({
            reference: finding.reference,
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

main().catch((error) => {
  console.error(paint("red", `Error: ${error.message}`));
  process.exit(1);
});
