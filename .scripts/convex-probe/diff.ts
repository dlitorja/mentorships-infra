#!/usr/bin/env -S npx tsx
/* eslint-disable */
// diff.ts — compare the current scan artifacts against the committed baseline.
//
// Reads `artifacts/findings-raw.json` (scan-b) and
// `artifacts/findings-noauth.json` (scan-d), diffs them by (file, function,
// shape) against `tier1.diff.json` beside this script, and writes
// `artifacts/tier1.diff.json`.
//
// Usage:
//   tsx diff.ts                 # advisory: print + write the diff artifact
//   tsx diff.ts --fail-on-new   # Phase B switch: exit 1 on new scan-d hits
//   tsx diff.ts --update        # rewrite tier1.diff.json from current scans
//
// The scanners already apply `suppressions.json`, so the baseline records the
// post-suppression surface — exactly what a Phase B gate would block on.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  diffAgainstBaseline,
  probeDirFromArgv,
  type Baseline,
  type BaselineFinding,
} from "./lib";

const cliArgs = process.argv.slice(2);
const failOnNew = cliArgs.includes("--fail-on-new");
const update = cliArgs.includes("--update");

const probeDir = probeDirFromArgv();
const baselinePath = resolve(probeDir, "tier1.diff.json");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

type RawB = { file: string; name: string; shape: string };
type RawD = { file: string; name: string };

const rawB = readJson<RawB[]>("./artifacts/findings-raw.json", []);
const rawD = readJson<RawD[]>("./artifacts/findings-noauth.json", []);

const currentB: BaselineFinding[] = rawB.map((f) => ({
  file: f.file,
  name: f.name,
  shape: f.shape,
}));
const currentD: BaselineFinding[] = rawD.map((f) => ({ file: f.file, name: f.name }));

function countByShape(findings: BaselineFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    const key = f.shape ?? "no-shape";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function label(finding: BaselineFinding): string {
  return finding.shape
    ? `${finding.file}::${finding.name} [${finding.shape}]`
    : `${finding.file}::${finding.name}`;
}

if (update) {
  const baseline: Baseline = {
    generatedAt: new Date().toISOString(),
    $comment:
      "Phase A exit artifact / week-over-week baseline for the Tier 1 convex authz probe. Regenerate with `npx tsx diff.ts --update` after a remediation wave merges. Findings are post-suppression (see suppressions.json).",
    scanB: {
      total: currentB.length,
      byShape: countByShape(currentB),
      findings: currentB,
    },
    scanD: {
      total: currentD.length,
      findings: currentD,
    },
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Baseline updated: ${baselinePath} (scan-b ${currentB.length}, scan-d ${currentD.length})`,
  );
  process.exit(0);
}

const baselineExists = existsSync(baselinePath);
if (!baselineExists) {
  console.warn(
    `[diff] No baseline at ${baselinePath}; every current finding counts as new. Run with --update to seed it.`,
  );
}

const baseline = readJson<Baseline>(baselinePath, {
  generatedAt: "unseeded",
  scanB: { total: 0, byShape: {}, findings: [] },
  scanD: { total: 0, findings: [] },
});

const scanB = diffAgainstBaseline(currentB, baseline.scanB.findings);
const scanD = diffAgainstBaseline(currentD, baseline.scanD.findings);

const result = {
  generatedAt: new Date().toISOString(),
  baselineGeneratedAt: baseline.generatedAt,
  scanB,
  scanD,
};

mkdirSync("./artifacts", { recursive: true });
writeFileSync("./artifacts/tier1.diff.json", JSON.stringify(result, null, 2));

function line(name: string, diff: ReturnType<typeof diffAgainstBaseline>): string {
  const shapeTally = Object.entries(diff.byShape)
    .map(([shape, count]) => `${shape}=${count}`)
    .join(" ");
  return `${name}: ${diff.total} hits (baseline ${diff.baselineTotal}) — new ${diff.new.length}, fixed ${diff.fixed.length}${shapeTally ? ` (${shapeTally})` : ""}`;
}

console.log(line("scan-b", scanB));
console.log(line("scan-d", scanD));

for (const finding of scanD.new.slice(0, 20)) console.log(`  NEW scan-d: ${label(finding)}`);
if (scanD.new.length > 20) console.log(`  … ${scanD.new.length - 20} more new scan-d hits`);
for (const finding of scanD.fixed.slice(0, 20)) console.log(`  FIXED scan-d: ${label(finding)}`);

if (failOnNew && scanD.new.length > 0) {
  console.error(
    `[diff] Phase B gate: ${scanD.new.length} new scan-d hit(s) — merge blocked. Add an authz fix, or a suppressions.json entry with a reason and owner.`,
  );
  process.exit(1);
}
