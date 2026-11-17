import { describe, expect, test, vi } from "vitest";
import { parseArgs, verifyTarget } from "../../../.github/scripts/verify-production-alias.mjs";

/**
 * The deploy pipeline used to treat "a production deployment exists for this
 * SHA" as "the deploy is done". On 2026-11-16 the custom domain stayed pinned to
 * an eight-hour-old deployment while four newer ones sat READY, so a merged fix
 * was never live and the admin UI kept the old bug. These tests pin the alias
 * assertion that turns that into a red check (and self-heals by promoting).
 */

const SHA = "9a321d901bf1762d50215e795502dd745b28f588";
const OLD_SHA = "0105e59b445022679b35d774a140d84b297cf109";

function fakeClock() {
  let t = 0;
  return { now: () => (t += 100), sleep: async () => {} };
}

/**
 * Builds a fake fetch that answers by path. `aliasSequence` is consumed one
 * entry per alias lookup, so a test can model "still stale, then promoted".
 */
function makeFetch({ readyDeployments, aliasSequence, deploymentShaById = {}, deploymentCreatedAt = {} }) {
  const calls = [];
  let aliasIndex = 0;

  const fetchImpl = vi.fn(async (input, init = {}) => {
    const path = String(input).replace("https://api.vercel.com", "");
    calls.push({ path, method: init.method ?? "GET" });

    if (path.startsWith("/v6/deployments")) {
      return json(200, { deployments: readyDeployments });
    }
    if (path.startsWith("/v4/aliases/")) {
      const current = aliasSequence[Math.min(aliasIndex, aliasSequence.length - 1)];
      aliasIndex++;
      if (current === null) return json(404, { error: "not_found" });
      return json(200, { alias: "x", deploymentId: current });
    }
    if (path.startsWith("/v13/deployments/")) {
      const id = decodeURIComponent(path.split("/v13/deployments/")[1].split("?")[0]);
      return json(200, {
        id,
        createdAt: deploymentCreatedAt[id] ?? 1_000,
        meta: { githubCommitSha: deploymentShaById[id] ?? OLD_SHA },
      });
    }
    if (path.includes("/promote/")) {
      // The real endpoint answers 200 with an empty body; parsing it as JSON
      // used to throw and abort verification before the re-check.
      return { ok: true, status: 200, json: async () => { throw new Error("no body"); }, text: async () => "" };
    }
    return json(404, { error: `unexpected ${path}` });
  });

  return { fetchImpl, calls };
}

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("parseArgs", () => {
  test("collects project/alias pairs", () => {
    const parsed = parseArgs([
      "--sha",
      SHA,
      "--team",
      "team_1",
      "--project",
      "prj_a",
      "--alias",
      "a.example.com",
      "--project",
      "prj_b",
      "--alias",
      "b.example.com",
    ]);
    expect(parsed.sha).toBe(SHA);
    expect(parsed.team).toBe("team_1");
    expect(parsed.targets).toEqual([
      { project: "prj_a", alias: "a.example.com" },
      { project: "prj_b", alias: "b.example.com" },
    ]);
  });

  test("rejects a project without an alias", () => {
    expect(() => parseArgs(["--sha", SHA, "--team", "t", "--project", "prj_a"])).toThrow(
      /--project requires a following --alias/
    );
  });

  test("requires sha", () => {
    expect(() => parseArgs(["--team", "t", "--project", "p", "--alias", "a"])).toThrow(/--sha/);
  });

  test("tolerates a missing team so CI can skip instead of blocking merges", () => {
    const parsed = parseArgs(["--sha", SHA, "--project", "p", "--alias", "a"]);
    expect(parsed.team).toBe("");
  });
});

describe("verifyTarget", () => {
  const base = {
    token: "t",
    team: "team_1",
    project: "prj_a",
    alias: "dev.example.com",
    sha: SHA,
    timeoutMs: 1_000,
    pollMs: 0,
  };

  test("passes when the alias already serves this commit", async () => {
    const { fetchImpl, calls } = makeFetch({
      readyDeployments: [{ uid: "dpl_new", readyState: "READY", createdAt: 2_000 }],
      aliasSequence: ["dpl_new"],
      deploymentShaById: { dpl_new: SHA },
    });

    const result = await verifyTarget({ ...base, fetchImpl, ...fakeClock() });

    expect(result).toMatchObject({ ok: true, promoted: false });
    expect(calls.some((c) => c.path.includes("/promote/"))).toBe(false);
  });

  test("promotes when the domain is stale, then passes", async () => {
    const { fetchImpl, calls } = makeFetch({
      readyDeployments: [{ uid: "dpl_new", readyState: "READY", createdAt: 2_000 }],
      // Stale on first look, correct once the promotion lands.
      aliasSequence: ["dpl_old", "dpl_new"],
      deploymentShaById: { dpl_old: OLD_SHA, dpl_new: SHA },
    });

    const result = await verifyTarget({ ...base, fetchImpl, ...fakeClock() });

    expect(result).toMatchObject({ ok: true, promoted: true });
    expect(calls.some((c) => c.path.includes("/promote/dpl_new"))).toBe(true);
  });

  test("fails when no READY deployment exists for the commit", async () => {
    const { fetchImpl } = makeFetch({ readyDeployments: [], aliasSequence: ["dpl_old"] });

    const result = await verifyTarget({ ...base, fetchImpl, ...fakeClock() });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no READY production deployment/);
  });

  test("fails when the alias never moves after promotion", async () => {
    const { fetchImpl } = makeFetch({
      readyDeployments: [{ uid: "dpl_new", readyState: "READY", createdAt: 2_000 }],
      aliasSequence: ["dpl_old"],
      deploymentShaById: { dpl_old: OLD_SHA, dpl_new: SHA },
    });

    const result = await verifyTarget({ ...base, fetchImpl, ...fakeClock() });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/still points at dpl_old/);
  });

  test("--dry-run reports staleness without promoting", async () => {
    const { fetchImpl, calls } = makeFetch({
      readyDeployments: [{ uid: "dpl_new", readyState: "READY", createdAt: 2_000 }],
      aliasSequence: ["dpl_old"],
      deploymentShaById: { dpl_old: OLD_SHA, dpl_new: SHA },
    });

    const result = await verifyTarget({ ...base, fetchImpl, dryRun: true, ...fakeClock() });

    expect(result).toMatchObject({ ok: false, dryRun: true });
    expect(result.reason).toMatch(/would promote dpl_new/);
    expect(calls.some((c) => c.path.includes("/promote/"))).toBe(false);
  });

  test("refuses to roll production back to an older deployment", async () => {
    // A re-run of CI for an older commit must not move the domain backwards.
    const { fetchImpl, calls } = makeFetch({
      readyDeployments: [{ uid: "dpl_old", readyState: "READY", createdAt: 1_000 }],
      aliasSequence: ["dpl_new"],
      deploymentShaById: { dpl_old: OLD_SHA, dpl_new: SHA },
      deploymentCreatedAt: { dpl_old: 1_000, dpl_new: 2_000 },
    });

    const result = await verifyTarget({ ...base, sha: OLD_SHA, fetchImpl, ...fakeClock() });

    expect(result).toMatchObject({ ok: true, skipped: true, promoted: false });
    expect(result.reason).toMatch(/newer deployment/);
    expect(calls.some((c) => c.path.includes("/promote/"))).toBe(false);
  });

  test("treats a missing alias record as stale rather than crashing", async () => {
    const { fetchImpl } = makeFetch({
      readyDeployments: [{ uid: "dpl_new", readyState: "READY", createdAt: 2_000 }],
      aliasSequence: [null, "dpl_new"],
      deploymentShaById: { dpl_new: SHA },
    });

    const result = await verifyTarget({ ...base, fetchImpl, ...fakeClock() });

    expect(result).toMatchObject({ ok: true, promoted: true });
  });
});
