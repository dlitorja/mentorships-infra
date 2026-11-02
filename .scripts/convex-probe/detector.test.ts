import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  diffAgainstBaseline,
  hasAuthCheck,
  hasIdentityComparison,
  loadSuppressions,
  partitionSuppressed,
  type Finding,
} from "./lib";

// ---------------------------------------------------------------------------
// Detector gaps from docs/security/tier1-probe-triage-2026-10.md §4
// ---------------------------------------------------------------------------

test("scan-d: recognises a service-key assertion", () => {
  assert.equal(hasAuthCheck('assertServiceKey(args.serviceKey);'), true);
});

test("scan-d: recognises a declared serviceKey arg", () => {
  assert.equal(hasAuthCheck("args: { serviceKey: v.string() }"), true);
});

test("scan-d: recognises the upload delete helpers", () => {
  assert.equal(hasAuthCheck("await requireDeleteAccess(ctx, upload);"), true);
  assert.equal(hasAuthCheck("await requireAdminDeleteAccess(ctx);"), true);
  assert.equal(hasAuthCheck("await requireAssignedStudentForUpload(ctx, args.onboardingId);"), true);
});

test("scan-d: recognises a role check on a resolved caller object", () => {
  assert.equal(hasAuthCheck('if (caller.role === "instructor") {'), true);
});

test("scan-d: does not treat a bare identity.subject mention as auth", () => {
  // scan-d must stay strict: mentioning the subject is not a gate.
  assert.equal(hasAuthCheck("console.log(identity.subject);"), false);
});

test("scan-b: treats a bare identity.subject mention as auth", () => {
  assert.equal(
    hasAuthCheck("console.log(identity.subject);", { allowBareSubjectReference: true }),
    true,
  );
});

test("scan-b: recognises a right-hand .subject comparison", () => {
  assert.equal(hasIdentityComparison("if (instructor.userId !== user.subject) return null;"), true);
});

test("scan-b: recognises ownership via a loaded instructor row", () => {
  assert.equal(
    hasIdentityComparison("if (workspace.instructorId !== instructor._id) return [];"),
    true,
  );
});

test("scan-b: recognises admin helper gates (the #962 gap)", () => {
  assert.equal(hasIdentityComparison("if (!(await isAdminUser(ctx, identity.subject))) {}"), true);
  assert.equal(hasIdentityComparison("const actor = await requireAdminActor(ctx);"), true);
});

test("scan-b: ignores comparisons inside comments and strings", () => {
  const body = `
    // if (row.userId === identity.subject) — historical note
    const note = "x !== user.subject";
    return null;
  `;
  assert.equal(hasIdentityComparison(body), false);
});

test("scan-b: an unguarded body has no identity comparison", () => {
  assert.equal(hasIdentityComparison("const user = await ctx.auth.getUserIdentity();"), false);
});

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

function tempProbeDir(suppressions: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "convex-probe-"));
  writeFileSync(join(dir, "suppressions.json"), JSON.stringify({ suppressions }, null, 2));
  return dir;
}

const finding: Finding = {
  file: "contacts.ts",
  line: 1,
  name: "addContact",
  msg: "public mutation performs insert with NO auth check at all",
};

test("suppressions: an active entry hides a matching finding", () => {
  const dir = tempProbeDir([
    {
      file: "contacts.ts",
      function: "addContact",
      scanner: "scan-d",
      reason: "accepted public form",
      owner: "@dlitorja",
      expires: "2099-01-01",
    },
  ]);
  const { active, expired, invalid } = loadSuppressions(dir, { today: new Date("2026-11-02") });
  assert.equal(active.length, 1);
  assert.equal(expired.length, 0);
  assert.equal(invalid.length, 0);

  const { kept, suppressed } = partitionSuppressed([finding], active, "scan-d");
  assert.equal(kept.length, 0);
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].suppression.reason, "accepted public form");
});

test("suppressions: an expired entry resurfaces the finding", () => {
  const dir = tempProbeDir([
    {
      file: "contacts.ts",
      function: "addContact",
      scanner: "scan-d",
      reason: "accepted public form",
      owner: "@dlitorja",
      expires: "2026-01-01",
    },
  ]);
  const { active, expired } = loadSuppressions(dir, { today: new Date("2026-11-02") });
  assert.equal(active.length, 0);
  assert.equal(expired.length, 1);

  const { kept, suppressed } = partitionSuppressed([finding], active, "scan-d");
  assert.equal(kept.length, 1);
  assert.equal(suppressed.length, 0);
});

test("suppressions: entries are scanner-scoped", () => {
  const dir = tempProbeDir([
    {
      file: "contacts.ts",
      function: "addContact",
      scanner: "scan-b",
      reason: "different scanner",
      owner: "@dlitorja",
    },
  ]);
  const { active } = loadSuppressions(dir, { today: new Date("2026-11-02") });
  const { kept } = partitionSuppressed([finding], active, "scan-d");
  assert.equal(kept.length, 1);
});

test("suppressions: invalid entries are reported, not applied", () => {
  const dir = tempProbeDir([{ file: "contacts.ts", scanner: "scan-d" }]);
  const { active, invalid } = loadSuppressions(dir, { today: new Date("2026-11-02") });
  assert.equal(active.length, 0);
  assert.equal(invalid.length, 1);
});

test("suppressions: a missing file means no suppressions", () => {
  const dir = mkdtempSync(join(tmpdir(), "convex-probe-empty-"));
  const { active, expired, invalid } = loadSuppressions(dir);
  assert.deepEqual([active.length, expired.length, invalid.length], [0, 0, 0]);
});

// ---------------------------------------------------------------------------
// Baseline diff
// ---------------------------------------------------------------------------

test("diff: separates new and fixed findings by file/function/shape", () => {
  const baseline = [
    { file: "a.ts", name: "one", shape: "b" },
    { file: "a.ts", name: "two", shape: "d" },
    { file: "a.ts", name: "gone", shape: "b" },
  ];
  const current = [
    { file: "a.ts", name: "one", shape: "b" },
    { file: "a.ts", name: "two", shape: "b" },
    { file: "a.ts", name: "brand-new", shape: "b" },
  ];

  const diff = diffAgainstBaseline(current, baseline);
  assert.equal(diff.total, 3);
  assert.equal(diff.baselineTotal, 3);
  assert.deepEqual(diff.byShape, { b: 3 });
  assert.deepEqual(diff.new.map((f) => f.name).sort(), ["brand-new", "two"]);
  assert.deepEqual(diff.fixed.map((f) => f.name).sort(), ["gone", "two"]);
});

test("diff: identical surfaces produce no drift", () => {
  const findings = [{ file: "a.ts", name: "one" }];
  const diff = diffAgainstBaseline(findings, findings);
  assert.equal(diff.new.length, 0);
  assert.equal(diff.fixed.length, 0);
});
