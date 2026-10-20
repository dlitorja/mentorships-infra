import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  SECRET_FLAGS,
  parseArgs,
  redact,
  computeNextRole,
  isAlreadyFullyStamped,
  buildMergedMetadata,
  stampConvexUserRole,
  readConvexEnv,
} from "./claim-instructor-role.mts";

describe("redact", () => {
  it("returns secret-bearing args as <flag>=<REDACTED>", () => {
    // Greptile P2/Security: the canonical redactable set. Adding a
    // non-secret flag to SECRET_FLAGS would be a privacy regression.
    expect(redact("--clerk-secret-key=sk_xxx_secret_value")).toBe(
      "--clerk-secret-key=<REDACTED>",
    );
    expect(redact("--convex-http-key=abc_def_secret")).toBe(
      "--convex-http-key=<REDACTED>",
    );
  });

  it("passes through non-secret args unchanged", () => {
    expect(redact("--clerk-user-id=user_abc")).toBe("--clerk-user-id=user_abc");
    expect(redact("--instructor-id=inst_xyz")).toBe("--instructor-id=inst_xyz");
    expect(redact("--apply")).toBe("--apply");
    expect(redact("--bogus=ufo")).toBe("--bogus=ufo");
  });

  it("SECRET_FLAGS only contains the documented secret flag names (no accidental regressions)", () => {
    // Greptile P2/Security: locking the redact set. If a future change
    // adds an unrelated flag to SECRET_FLAGS, tests fail loudly.
    expect([...SECRET_FLAGS].sort()).toEqual(["clerk-secret-key", "convex-http-key"]);
  });
});

describe("parseArgs", () => {
  it("accepts the canonical --flag <space> value form", () => {
    const result = parseArgs([
      "--clerk-secret-key",
      "sk_xxx",
      "--clerk-user-id",
      "user_abc123",
    ]);
    expect(result).toEqual({
      clerkSecretKey: "sk_xxx",
      clerkUserId: "user_abc123",
      apply: false,
    });
    if ("error" in result) throw new Error("did-not-error");
    expect(result.clerkSecretKey).toBe("sk_xxx");
  });

  it("accepts the --flag=value equals form (Greptile P2/Security)", () => {
    // The previous parseArgs rejected this and ECHOED the entire
    // argument including the secret. Now it parses cleanly.
    const result = parseArgs([
      "--clerk-secret-key=sk_xxx",
      "--clerk-user-id=user_abc123",
    ]);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("expected parse success");
    expect(result.clerkSecretKey).toBe("sk_xxx");
    expect(result.clerkUserId).toBe("user_abc123");
  });

  it("mixes equals and space forms correctly", () => {
    // Operator types one form, the docs say another — both must work.
    const result = parseArgs([
      "--clerk-secret-key=sk_xxx",
      "--clerk-user-id",
      "user_abc123",
      "--instructor-id=inst_xyz",
      "--apply",
    ]);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("expected parse success");
    expect(result.clerkSecretKey).toBe("sk_xxx");
    expect(result.clerkUserId).toBe("user_abc123");
    expect(result.instructorId).toBe("inst_xyz");
    expect(result.apply).toBe(true);
  });

  it("redacts an unrecognized secret-bearing arg via the default branch (Greptile P2/Security)", () => {
    // Greptile's exact scenario: `--convex-http-key=<SECRET>` falls
    // into the unknown-flag path. The OLD parser ECHOED the entire
    // argument, leaking the secret into CI logs. The new parser
    // splits the equals-form first, so `a` is just the flag name
    // (no value attached) when the default branch runs; the value
    // is in `inlineValue` and never surfaces. Combined with
    // `redact()` for the residual non-equals cases, the secret
    // never reaches the error message.
    const result = parseArgs([
      "--convex-http-key=sk_top_secret_value",
    ]);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    // The whole point of the fix: secret value never appears.
    expect(result.error).not.toContain("sk_top_secret_value");
    expect(result.error).not.toContain("sk_");
    // The error still names the offending arg shape so the operator
    // can fix it without unredacted context.
    expect(result.error.toLowerCase()).toMatch(/unknown flag/);
    expect(result.error).toContain("--convex-http-key");
  });

  it("redacts a non-secret-bearing unknown flag's value when entered in equals form", () => {
    // The redact() helper is the second layer of defense for args
    // that DID get past the splitter. For a non-secret flag like
    // `--bogus=`, the value is harmless — it's the user's own input.
    // But we still verify the splitter strips the value before the
    // default branch runs.
    const result = parseArgs([
      "--bogus=hello-world",
    ]);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    // The splitter pulled "hello-world" off; the default branch sees
    // only `--bogus`. The secret-flags set does NOT include bogus,
    // so the whole flag name is shown.
    expect(result.error).toContain("--bogus");
    expect(result.error).not.toContain("hello-world");
  });

  it("--clerk-secret-key=<SECRET> parses cleanly under the new equals support (Greptile P2/Security)", () => {
    // The OLD parser rejected this form. The NEW parser accepts it.
    // Verify the secret lands on out.clerkSecretKey as-is AND that the
    // equals form is not dropped to the default branch.
    const result = parseArgs([
      "--clerk-secret-key=sk_top_secret_value",
      "--clerk-user-id=user_abc123",
    ]);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("did-not-error");
    expect(result.clerkSecretKey).toBe("sk_top_secret_value");
  });

  it("missing a required flag reports a clear error without echoing any prior flag", () => {
    const result = parseArgs(["--apply"]);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toBe("Missing --clerk-user-id");
  });

  it("--clerk-user-id wrong prefix raises with the prefix hint (operator fixable, not secret-bearing)", () => {
    // The bad value IS shown to the operator (truncated to the first
    // 12 chars, but `inst_xxx` is 8 so it shows intact) because Clerk
    // user ids are not sensitive — the truncation is just to keep
    // the error line narrow. Greptile's concern was secrets, not
    // this prefix hint.
    const result = parseArgs(["--clerk-user-id", "inst_xxx"]);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/must start with "user_"/);
    expect(result.error).toContain("got ");
  });

  // Greptile P1 (nineteenth pass): --apply=false previously fell
  // through as if --apply was set (apply:true), so a wrapper that
  // forwards `--apply=${SOME_FLAG}` with SOME_FLAG=false would
  // silently write to prod. The new parser accepts inline-value
  // booleans explicitly: --apply | --apply=true | --apply=false |
  // --apply=1 | --apply=0 all behave, but other inline values
  // raise an error rather than coerce.
  it("--apply (no value) sets apply=true (the typed default)", () => {
    const result = parseArgs(["--clerk-user-id", "user_abc", "--apply"]);
    expect("apply" in result).toBe(true);
    if (!("apply" in result)) throw new Error("expected ok");
    expect(result.apply).toBe(true);
  });

  it("--apply=true sets apply=true", () => {
    const result = parseArgs(["--clerk-user-id", "user_abc", "--apply=true"]);
    expect("apply" in result).toBe(true);
    if (!("apply" in result)) throw new Error("expected ok");
    expect(result.apply).toBe(true);
  });

  it('--apply=false is honored (does NOT silently default to apply:true)', () => {
    const result = parseArgs(["--clerk-user-id", "user_abc", "--apply=false"]);
    expect("apply" in result).toBe(true);
    if (!("apply" in result)) throw new Error("expected ok");
    expect(result.apply).toBe(false);
  });

  it("--apply=0 is honored (does NOT silently default to apply:true)", () => {
    const result = parseArgs(["--clerk-user-id", "user_abc", "--apply=0"]);
    expect("apply" in result).toBe(true);
    if (!("apply" in result)) throw new Error("expected ok");
    expect(result.apply).toBe(false);
  });

  it("--apply=garbage raises an error rather than coercing", () => {
    const result = parseArgs([
      "--clerk-user-id",
      "user_abc",
      "--apply=maybe",
    ]);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error).toMatch(/--apply, if given inline/);
  });
});

describe("computeNextRole", () => {
  it("returns the elevated role unchanged when present", () => {
    // Same gate as the helper in `lib/clerk-invitations.ts`. An
    // admin who is misrun through this script must NOT be silently
    // demoted to instructor.
    expect(computeNextRole("admin")).toBe("admin");
    expect(computeNextRole("video_editor")).toBe("video_editor");
    expect(computeNextRole("support")).toBe("support");
  });

  it("returns 'instructor' for non-elevated current roles", () => {
    expect(computeNextRole("student")).toBe("instructor");
    expect(computeNextRole(undefined)).toBe("instructor");
    expect(computeNextRole("")).toBe("instructor");
    // Unknown strings are NOT elevated — fall back to "instructor".
    expect(computeNextRole("superuser")).toBe("instructor");
  });
});

describe("isAlreadyFullyStamped", () => {
  it("returns true on fully-stamped metadata without instructorId (matches helper)", () => {
    expect(
      isAlreadyFullyStamped(
        { role: "instructor", isInstructor: true, custom: "keep" },
        undefined,
      ),
    ).toBe(true);
  });

  it("returns true when both flags AND instructorId match (Greptile P2 — script side)", () => {
    // The script also has this gate (the helper mirrors it). The
    // shape: `instructorId` on the user's metadata equals the
    // caller-supplied id — short-circuit.
    expect(
      isAlreadyFullyStamped(
        { role: "instructor", isInstructor: true, instructorId: "inst_xxx" },
        "inst_xxx",
      ),
    ).toBe(true);
  });

  it("returns false when instructorId on disk is stale (Greptile P2 — script side)", () => {
    // Caller passes --instructor-id but the user's existing
    // publicMetadata.instructorId differs (e.g. rebound to a new
    // Convex instructors row). The short-circuit must NOT fire —
    // the script needs to re-write to apply the correction.
    expect(
      isAlreadyFullyStamped(
        { role: "instructor", isInstructor: true, instructorId: "inst_old" },
        "inst_new",
      ),
    ).toBe(false);
  });

  it("returns false when role is missing (only one flag stamped)", () => {
    expect(
      isAlreadyFullyStamped({ isInstructor: true }, undefined),
    ).toBe(false);
    expect(
      isAlreadyFullyStamped({ role: "instructor" }, undefined),
    ).toBe(false);
  });
});

describe("buildMergedMetadata", () => {
  it("writes isInstructor + role=instructor for a student", () => {
    const merged = buildMergedMetadata(
      { role: "student", isInstructor: false, foo: "keep" },
      undefined,
    );
    expect(merged).toEqual({
      role: "instructor",
      isInstructor: true,
      foo: "keep",
    });
  });

  it("preserves elevated role (admin does NOT get demoted to instructor)", () => {
    const merged = buildMergedMetadata(
      { role: "admin", adminFlag: "keep" },
      undefined,
    );
    expect(merged).toEqual({
      role: "admin",
      isInstructor: true,
      adminFlag: "keep",
    });
  });

  it("stamps instructorId when supplied", () => {
    const merged = buildMergedMetadata(
      { role: "student", unrelated: "kept" },
      "inst_xyz",
    );
    expect(merged).toEqual({
      role: "instructor",
      isInstructor: true,
      unrelated: "kept",
      instructorId: "inst_xyz",
    });
  });

  it("overwrites a stale instructorId with the caller-supplied id", () => {
    const merged = buildMergedMetadata(
      { role: "instructor", isInstructor: true, instructorId: "inst_old" },
      "inst_new",
    );
    expect(merged).toEqual({
      role: "instructor",
      isInstructor: true,
      instructorId: "inst_new",
    });
  });
});

describe("stampConvexUserRole", () => {
  const baseArgs = {
    clerkSecretKey: "sk_xxx",
    clerkUserId: "user_abc123",
    apply: true as const,
    convexUrl: "https://example.convex.site",
    convexHttpKey: "convex_xxx",
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips when Convex env is unset and reports ok=true (Clerk-only path)", async () => {
    const result = await stampConvexUserRole(
      {
        ...baseArgs,
        convexUrl: undefined,
        convexHttpKey: undefined,
      },
      "instructor",
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/env unset/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when dry-run (no --apply)", async () => {
    const result = await stampConvexUserRole(
      {
        ...baseArgs,
        apply: false,
      },
      "instructor",
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/dry-run/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to /users/ops-set-role with bearer auth and the right body shape", async () => {
    // Mock the `httpOpsRepairSetUserRole` 200 success shape: the body
    // is the user object directly (NOT wrapped in `{user: ...}`),
    // with `role: "instructor"` since that's what we asked for.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            _id: "u1",
            userId: "user_abc123",
            email: "abc@example.com",
            clerkId: "user_abc123",
            role: "instructor",
          }),
        ),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://example.convex.site/users/ops-set-role");
    expect(calledInit.method).toBe("POST");
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe(`Bearer ${baseArgs.convexHttpKey}`);
    expect(JSON.parse(String(calledInit.body))).toEqual({
      userId: "user_abc123",
      role: "instructor",
    });
  });

  it("forwards email when supplied (Greptile P1 tenth pass — required for missing-user insert path)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            _id: "u1",
            userId: "user_abc123",
            email: "abc@example.com",
            clerkId: "user_abc123",
            role: "instructor",
          }),
        ),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor", {
      email: "abc@example.com",
    });
    expect(result.ok).toBe(true);
    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(calledInit.body))).toEqual({
      userId: "user_abc123",
      role: "instructor",
      email: "abc@example.com",
    });
  });

  it("omits email key when not supplied (back-compat: --email flag optional)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ role: "instructor" })),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(true);
    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(calledInit.body));
    expect(body).toEqual({ userId: "user_abc123", role: "instructor" });
    expect("email" in body).toBe(false);
  });

  it("treats a 409 preserved-elevated response as success-with-notice (Greptile P1)", async () => {
    // The route returns 409 + `{ error, preserved: true, currentRole }`
    // when refusing to overwrite an elevated role. The script treats
    // that as a successful no-op (the stamp did NOT happen, but the
    // operator wanted the safe behavior).
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: 'Refusing to overwrite elevated role "admin" with "instructor"',
            preserved: true,
            currentRole: "admin",
            requestedRole: "instructor",
          }),
        ),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(true);
    expect(result.preserved).toBe(true);
    expect(result.currentRole).toBe("admin");
    expect(result.reason).toMatch(/elevated-role/);
  });

  /**
   * Greptile P1 (twenty-second pass, follow-up): the prior script
   * treated every HTTP 409 from /users/ops-set-role as
   * success-with-notice. After the twenty-first-pass email-conflict
   * guard landed, the route now also returns 409 with
   * `code: "email-belongs-to-another"` when it refuses to insert a
   * competing row. That 409 is NOT a preservation success; it is a
   * real failure that must surface so the operator reconciles the
   * duplicate-account situation before retrying.
   */
  it("treats a 409 email-belongs-to-another response as a real failure (Greptile P1 twenty-second pass)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error:
              'Refusing to create a users row for "user_new" at email "shared@example.com": that email is already linked to user "user_legacy".',
            code: "email-belongs-to-another",
            attempted: {
              userId: "user_new",
              email: "shared@example.com",
            },
            existing: {
              userId: "user_legacy",
              clerkId: "user_legacy",
              role: "student",
            },
          }),
        ),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor");
    // It is a failure -- ok:false. The user has no Convex row.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("email-belongs-to-another");
    if (!result.ok) {
      // The reason surfaces both identities so the operator has
      // enough info to reconcile before retrying.
      expect(result.reason).toMatch(/shared@example\.com/);
      expect(result.reason).toMatch(/user_legacy/);
    }
  });

  it("treats a 409 without preserved or code as a real failure (defensive)", async () => {
    // Defensive: an unknown 409 shape should also be a failure so
    // the operator doesn't think the script succeeded when it did
    // not.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () =>
        Promise.resolve(JSON.stringify({ error: "some unexpected 409" })),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(false);
  });

  it("fails when the server returns 200 but role mismatches the script's expectedRole", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            _id: "u1",
            userId: "user_abc123",
            role: "student",
          }),
        ),
    });

    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/returned role=/);
  });

  it("fails when the server returns a non-OK, non-409 status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: "kaboom" })),
    });
    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/returned 500/);
  });

  it("fails when the server returns 200 but a 200 response with no role field", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ unexpected: "shape" })),
    });
    const result = await stampConvexUserRole(baseArgs, "instructor");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/role=/);
  });
});

describe("readConvexEnv", () => {
  /**
   * Greptile P1 (seventeenth pass): when `CONVEX_URL` is set to a
   * `.convex.cloud` URL (dashboard URL) the script must still
   * rewrite to `.convex.site` so the HTTP POST lands on the
   * action-host. The previous version only applied the rewrite
   * when reading from `NEXT_PUBLIC_CONVEX_URL` -- a developer
   * copying the dashboard URL into `CONVEX_URL` would silently
   * reach the wrong host with no error.
   */
  it("rewrites a CONVEX_URL .convex.cloud URL to .convex.site", () => {
    const out = readConvexEnv({
      CONVEX_URL: "https://mentorships-prod.convex.cloud",
      CONVEX_HTTP_KEY: "convex_xxx",
    });
    expect(out.url).toBe("https://mentorships-prod.convex.site");
    expect(out.httpKey).toBe("convex_xxx");
  });

  it("rewrites a NEXT_PUBLIC_CONVEX_URL .convex.cloud URL to .convex.site", () => {
    const out = readConvexEnv({
      CONVEX_URL: undefined,
      NEXT_PUBLIC_CONVEX_URL: "https://mentorships-prod.convex.cloud",
      CONVEX_HTTP_KEY: "convex_xxx",
    });
    expect(out.url).toBe("https://mentorships-prod.convex.site");
  });

  it("passes through a URL that is already on .convex.site", () => {
    const out = readConvexEnv({
      CONVEX_URL: "https://example.convex.site",
      CONVEX_HTTP_KEY: "convex_xxx",
    });
    expect(out.url).toBe("https://example.convex.site");
  });

  it("strips trailing slashes", () => {
    const out = readConvexEnv({
      CONVEX_URL: "https://example.convex.site/",
      CONVEX_HTTP_KEY: "convex_xxx",
    });
    expect(out.url).toBe("https://example.convex.site");
  });

  it("prefers CONVEX_URL over NEXT_PUBLIC_CONVEX_URL when both set", () => {
    const out = readConvexEnv({
      CONVEX_URL: "https://primary.convex.site",
      NEXT_PUBLIC_CONVEX_URL: "https://fallback.convex.cloud",
      CONVEX_HTTP_KEY: "convex_xxx",
    });
    expect(out.url).toBe("https://primary.convex.site");
  });

  it("returns empty strings when nothing is set", () => {
    const out = readConvexEnv({});
    expect(out.url).toBe("");
    expect(out.httpKey).toBe("");
  });
});
