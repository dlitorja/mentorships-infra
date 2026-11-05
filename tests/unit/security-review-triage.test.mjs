import { describe, expect, it } from "vitest";

import {
  buildIssue,
  extractPage,
  interpretLinearOutput,
  issueCarriesFinding,
  markerFor,
  normalizeFinding,
  pickIdentifier,
  rank,
  referencesIn,
  toPages,
} from "../../scripts/security-review-triage.mjs";

/**
 * Regression tests for scripts/security-review-triage.mjs.
 *
 * These cover the bugs found in review of #1018 (by Greptile and Vercel Agent), so a future
 * change cannot quietly reintroduce them:
 *   - prefix reference matching that skipped separate findings
 *   - Linear tool errors treated as success / as "no match"
 *   - a saved bare findings array treated as pages, silently hiding findings
 *   - the real payload shape (`target` / `number` / `findingId`, not `project`)
 */

const page = (overrides = {}) => ({
  vulnerabilities: [
    {
      findingId: "01CRIT12",
      number: 12,
      target: { id: "prj_plat", kind: "project" },
      severity: "critical",
      status: "open",
      title: "Authz bypass",
      environment: "production",
      branchRef: "main",
      vulnerabilityClass: "CWE-639",
      summary: "student reads another student's workspace",
    },
    {
      findingId: "01HIGH1",
      number: 1,
      target: { id: "prj_plat", kind: "project" },
      severity: "high",
      status: "open",
      title: "Different finding",
    },
  ],
  repositories: [{ id: "prj_plat", name: "mentorships-infra-platform" }],
  pagination: { next: null },
  ...overrides,
});

describe("reference matching", () => {
  const issue = { title: "Security Review: critical — Authz bypass", description: `<!-- ${markerFor("mentorships-infra-platform/12")} -->\n\nbody` };

  it("matches the whole reference", () => {
    expect(issueCarriesFinding(issue, "mentorships-infra-platform/12")).toBe(true);
  });

  it("does not treat platform/1 as already tracked because platform/12 exists", () => {
    // The original bug: a prefix match reported a distinct finding as already filed.
    expect(issueCarriesFinding(issue, "mentorships-infra-platform/1")).toBe(false);
  });

  it("extracts every marker in an issue", () => {
    expect(referencesIn(issue)).toEqual(["mentorships-infra-platform/12"]);
    expect(referencesIn({ title: "no marker" })).toEqual([]);
  });
});

describe("payload parsing", () => {
  it("reads vulnerabilities, repositories and the next cursor", () => {
    const extracted = extractPage(page({ pagination: { next: "CURSOR1" } }));
    expect(extracted.list).toHaveLength(2);
    expect(extracted.repositories.get("prj_plat")).toBe("mentorships-infra-platform");
    expect(extracted.next).toBe("CURSOR1");
  });

  it("accepts a saved page, an array of pages, and a bare findings array", () => {
    expect(toPages(page())).toHaveLength(1);
    expect(toPages([page(), page()])).toHaveLength(2);

    const bare = toPages([{ reference: "platform/1", severity: "high", title: "Example" }]);
    expect(bare).toHaveLength(1);
    expect(extractPage(bare[0]).list).toHaveLength(1);
  });
});

describe("normalizeFinding", () => {
  const repositories = new Map([["prj_plat", "mentorships-infra-platform"]]);

  it("builds the reference the same way the CLI's toReference does", () => {
    const [finding] = extractPage(page()).list.map((raw, i) => normalizeFinding(raw, i, repositories));
    expect(finding.reference).toBe("mentorships-infra-platform/12");
    expect(finding.findingId).toBe("01CRIT12");
    expect(finding.project).toBe("mentorships-infra-platform");
    expect(finding.severity).toBe("critical");
    expect(finding.branch).toBe("main");
    expect(finding.vulnerabilityClass).toBe("CWE-639");
    expect(finding.dashboardPath).toBe("~/security/vulnerabilities/01CRIT12");
  });

  it("uses an unmatched target id verbatim instead of collapsing to unknown-project", () => {
    const raw = { findingId: "01X", number: 3, target: { id: "prj_unknown" }, severity: "high", title: "t" };
    expect(normalizeFinding(raw, 0, repositories).reference).toBe("prj_unknown/3");
  });

  it("throws rather than fabricating an identity", () => {
    expect(() => normalizeFinding({ severity: "high", title: "t" }, 0, repositories)).toThrow(
      /cannot be deduped safely/
    );
  });
});

describe("linear responses", () => {
  it("rejects an error envelope returned with a zero exit code", () => {
    expect(() =>
      interpretLinearOutput("issues", JSON.stringify({ status: "error", message: "Team HUC is not accessible" }))
    ).toThrow(/Team HUC is not accessible/);
  });

  it("rejects unreadable output instead of treating it as no results", () => {
    expect(() => interpretLinearOutput("issues", "Something went wrong")).toThrow(/unreadable output/);
  });

  it("passes through a valid list payload", () => {
    expect(interpretLinearOutput("issues", JSON.stringify({ issues: [] }))).toEqual({ issues: [] });
  });

  it("requires an identifier from create-issue", () => {
    expect(pickIdentifier({ issue: { identifier: "HUC-901" } })).toBe("HUC-901");
    expect(pickIdentifier({ identifier: "HUC-902" })).toBe("HUC-902");
    expect(pickIdentifier({ created: true })).toBeUndefined();
    expect(pickIdentifier(null)).toBeUndefined();
  });
});

describe("buildIssue", () => {
  const finding = normalizeFinding(extractPage(page()).list[0], 0, new Map([["prj_plat", "mentorships-infra-platform"]]));

  it("puts the dedupe marker on the first line", () => {
    expect(buildIssue(finding, {}).description.split("\n")[0]).toBe(
      `<!-- ${markerFor("mentorships-infra-platform/12")} -->`
    );
  });

  it("omits source-quoting details by default", () => {
    const withSource = { ...finding, description: "quotes source", fix: "patch" };
    expect(buildIssue(withSource, {}).description).not.toContain("quotes source");
    expect(buildIssue(withSource, { withDetails: true }).description).toContain("quotes source");
    expect(buildIssue(withSource, { withDetails: true }).description).toContain("**Details**");
  });

  it("links the dashboard finding and names the finding id", () => {
    const body = buildIssue(finding, {}).description;
    expect(body).toContain("01CRIT12");
    expect(body).toContain("/~/security/vulnerabilities/01CRIT12");
  });

  it("titles the issue with severity, title and target", () => {
    expect(buildIssue(finding, {}).title).toBe(
      "Security Review: critical — Authz bypass (mentorships-infra-platform)"
    );
  });
});

describe("severity ranking", () => {
  it("orders the ladder and tolerates an unknown level", () => {
    expect(rank("critical")).toBeGreaterThan(rank("high"));
    expect(rank("high")).toBeGreaterThan(rank("medium"));
    expect(rank("unknown")).toBe(0);
  });
});

describe("real payload (first finding surfaced by Security Review)", () => {
  // Verbatim shape of finding 01M6NZZKFVZZVZFRFW9DXKJN1P, as returned by
  // `vercel security vulnerabilities --status all --json`. Note `repositories: []` and a
  // project-id target: the CLI resolves the name with a project lookup, and so must we.
  const real = {
    vulnerabilities: [
      {
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
      },
    ],
    repositories: [],
    pagination: { next: null },
  };

  const projects = new Map([["prj_Qcxbu6iZDxeUibBLGaydhOQ916pB", "mentorships-infra-platform"]]);
  const [raw] = extractPage(real).list;

  it("resolves the project name so the reference matches the dashboard", () => {
    const finding = normalizeFinding(raw, 0, projects);
    expect(finding.reference).toBe("mentorships-infra-platform/1");
    expect(finding.findingId).toBe("01M6NZZKFVZZVZFRFW9DXKJN1P");
    expect(finding.status).toBe("closed");
    expect(finding.vulnerabilityClass).toBe("business-logic");
  });

  it("degrades to the project id when the name cannot be resolved", () => {
    expect(normalizeFinding(raw, 0, new Map()).reference).toBe(
      "prj_Qcxbu6iZDxeUibBLGaydhOQ916pB/1"
    );
  });

  it("carries the pull request that surfaced it", () => {
    const finding = normalizeFinding(raw, 0, projects);
    expect(finding.foundIn).toEqual({
      repository: "dlitorja/mentorships-infra",
      commitSha: "ca0a6ae747a32a8344db005fea708d2f7ae9d704",
      pullRequestNumber: 1021,
    });
    expect(finding.createdAt).toBe("2026-11-05T13:57:10.779Z");
    expect(buildIssue(finding, {}).description).toContain("**Found in:** PR #1021");
  });
});
