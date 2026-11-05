#!/usr/bin/env node
/**
 * Stand-in for the Vercel CLI, used by tests/unit/security-review-triage.test.mjs so the
 * project-lookup path runs for real (spawn, exit code, stdout shape) without a network call.
 *
 * Handles:
 *   project ls --json                                   -> { projects: [...] }
 *   security vulnerabilities --json [--next <cursor>]   -> a page of findings
 *   security vulnerabilities inspect <id> --json        -> { vulnerability: {...} }
 *
 * Set FAKE_VERCEL_PROJECT_LOOKUP=fail to make `project ls` exit non-zero, which exercises the
 * "name resolution failed, fall back to the project id" branch.
 */

const args = process.argv.slice(2);
const has = (needle) => args.includes(needle);

const FINDING = {
  findingId: "01M6NZZKFVZZVZFRFW9DXKJN1P",
  number: 1,
  environment: "preview",
  branchRef: "fix/duplicate-instructor-email",
  vulnerabilityClass: "business-logic",
  severity: "medium",
  title: "Unverified self-provisioning can squat another instructor's email",
  summary: "A signed-in user can self-provision with someone else's email.",
  status: "closed",
  createdAt: 1793887030779,
  target: { kind: "project", id: "prj_Qcxbu6iZDxeUibBLGaydhOQ916pB" },
  foundIn: {
    repository: "dlitorja/mentorships-infra",
    commitSha: "ca0a6ae747a32a8344db005fea708d2f7ae9d704",
    pullRequestNumber: 1021,
  },
  relatedFindings: [],
};

if (args[0] === "project" && args[1] === "ls") {
  if (process.env.FAKE_VERCEL_PROJECT_LOOKUP === "fail") {
    process.stderr.write("Error: insufficient permissions to list projects\n");
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      projects: [
        { id: "prj_Qcxbu6iZDxeUibBLGaydhOQ916pB", name: "mentorships-infra-platform" },
      ],
    }) + "\n"
  );
  process.exit(0);
}

if (args[0] === "security" && args[1] === "vulnerabilities") {
  if (has("inspect")) {
    process.stdout.write(
      JSON.stringify({
        vulnerability: {
          findingId: FINDING.findingId,
          description: "DETAILS from inspect",
          fix: "FIX from inspect",
        },
      }) + "\n"
    );
    process.exit(0);
  }

  // Two pages when a cursor is requested, so pagination keeps being exercised.
  const page = has("--next")
    ? {
        vulnerabilities: [
          {
            ...FINDING,
            findingId: "01PAGE2FINDING",
            number: 77,
            title: "Second page finding",
            severity: "high",
            target: { kind: "project", id: "prj_Qcxbu6iZDxeUibBLGaydhOQ916pB" },
          },
        ],
        repositories: [],
        pagination: { next: null },
      }
    : { vulnerabilities: [FINDING], repositories: [], pagination: { next: "CURSOR1" } };

  process.stdout.write(JSON.stringify(page) + "\n");
  process.exit(0);
}

process.stderr.write(`fake-vercel: unsupported invocation: ${args.join(" ")}\n`);
process.exit(2);
