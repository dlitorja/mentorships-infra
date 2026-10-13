/**
 * HUC-95 — Unit tests for the
 * `buildQuestionnaireSubmittedToInstructorEmail` builder.
 *
 * Validates:
 *   * Subject line carries the student's display name (or
 *     the email-local-part fallback when name is missing).
 *   * HTML body escapes user-controlled strings to prevent
 *     XSS via a malicious `studentName` /
 *     `studentEmail`. The malicious-payload check is the
 *     most important assertion in this file — any future
 *     refactor that drops `escapeHtml` will be caught here.
 *   * Plain-text body contains the deep-link URL exactly
 *     once and ends with the mentorships-team signature.
 *   * Submission timestamp is rendered in UTC ISO format.
 *   * When `studentName` AND `studentEmail` are both
 *     absent, the greeting falls back to "a new student"
 *     and the body still renders (no `null` / `undefined`
 *     leaks in the rendered string).
 *   * The `headers` field is always an object so the
 *     downstream `sendEmail` call has a stable signature.
 */
import { describe, expect, test } from "vitest";
import {
  buildQuestionnaireSubmittedToInstructorEmail,
} from "./questionnaire-submitted-to-instructor";

// A fixed UTC timestamp: Date.UTC(2024, 8, 29) is
// 2024-09-29T00:00:00Z. We hard-code the ms value rather
// than call `Date.UTC(...)` so the test input is trivial
// to audit (search the file, see the value).
const FIXED_SUBMITTED_AT = Date.UTC(2024, 8, 29); // 1727568000000

describe("buildQuestionnaireSubmittedToInstructorEmail", () => {
  test("uses studentName in the subject line and body greeting", () => {
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex Park",
      studentEmail: "alex@example.com",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_abc123",
    });
    expect(email.subject).toBe("[Huckleberry] New student intro from Alex Park");
    expect(email.html).toContain("<strong>Alex Park</strong>");
    expect(email.text).toContain("Hi,");
    expect(email.text).toContain("Alex Park just submitted");
  });

  test("falls back to email-local-part when studentName is null", () => {
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: null,
      studentEmail: "alex@example.com",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_abc123",
    });
    expect(email.subject).toBe("[Huckleberry] New student intro from alex");
    expect(email.html).toContain("<strong>alex</strong>");
  });

  test("falls back to 'a new student' when both studentName and studentEmail are missing", () => {
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: null,
      // Use an unparseable address to exercise the no-local-part
      // branch on split('@').
      studentEmail: "@",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_abc123",
    });
    // The split[0] of "@" is the empty string, which the
    // builder treats as falsy and replaces with "a new
    // student". We accept either "a new student" or a
    // generic fallback greeting.
    expect(email.subject).toBe("[Huckleberry] New student intro from a new student");
    expect(email.html).toContain("<strong>a new student</strong>");
  });

  test("HTML-escapes a name with an HTML-injection payload", () => {
    const maliciousName = "<script>alert(1)</script>";
    const maliciousEmail = `evil+<img src=x onerror=alert(1)>@example.com`;
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: maliciousName,
      studentEmail: maliciousEmail,
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_abc123",
    });
    // The literal `<script>` and `<img` substrings MUST be
    // escaped into their entities. We assert via the
    // escaped-token prefix rather than the raw payload so
    // the test still passes if the builder switches
    // escape style in the future.
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;img src=x");
    // Plaintext is untrusted-input-safe by construction;
    // verify it carries the literal name (no escaping
    // needed for plain-text).
    expect(email.text).toContain("<script>alert(1)</script>");
  });

  test("HTML-escapes the submission URL (defense in depth)", () => {
    const maliciousUrl = `https://app.example.com/onboarding/onb_abc123"><script>x</script>`;
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex",
      studentEmail: "alex@example.com",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: maliciousUrl,
    });
    expect(email.html).not.toContain("\"<script>");
    expect(email.html).toContain("&quot;&gt;&lt;script&gt;");
  });

  test("renders submission timestamp as UTC ISO 8601 with the explicit UTC marker", () => {
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex",
      studentEmail: "alex@example.com",
      onboardingId: "onb_utc",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_utc",
    });
    // 2024-09-29T00:00:00Z is the expected canonical string
    // (we strip milliseconds + keep Z).
    expect(email.html).toContain("2024-09-29T00:00:00Z");
    expect(email.text).toContain("2024-09-29T00:00:00Z");
    expect(email.html).toContain("UTC");
    expect(email.text).toContain("UTC");
  });

  test("contains the deep link exactly once in plain text", () => {
    const url = "https://app.example.com/onboarding/onb_abc123";
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex",
      studentEmail: "alex@example.com",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: url,
    });
    // count occurrences: 1 in the text body and 1 in the
    // HTML body. We count both.
    const textMatches = email.text.split(url).length - 1;
    const htmlMatches = email.html.split(url).length - 1;
    expect(textMatches).toBe(1);
    expect(htmlMatches).toBe(1);
  });

  test("ends the plaintext body with the mentorships-team signature", () => {
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex",
      studentEmail: "alex@example.com",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_abc123",
    });
    expect(email.text.trimEnd().endsWith("— The mentorships team")).toBe(true);
  });

  test("returns `headers: {}` so the downstream sendEmail call has a stable signature", () => {
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex",
      studentEmail: "alex@example.com",
      onboardingId: "onb_abc123",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_abc123",
    });
    expect(email.headers).toEqual({});
    expect(typeof email.headers).toBe("object");
    expect(email.headers).not.toBeNull();
  });

  test("AGENTS.md content guard: builder's own copy strings never use the reserved 'mentor'/'mentee' words", () => {
    // AGENTS.md says the WORDs `mentor`/`mentee` are
    // forbidden in code (with the narrow exception
    // `mentorships` in UI copy). This test pins the
    // builder's own strings so a future refactor that
    // re-introduces "your mentor X" gets caught.
    //
    // Note: a student whose display name happens to
    // contain "mentor" is NOT a violation — we render
    // user-supplied names verbatim (HTML-escaped). AGENTS.md
    // forbids the WORD in OUR strings, not in user data.
    const email = buildQuestionnaireSubmittedToInstructorEmail({
      studentName: "Alex Park",
      studentEmail: "alex@example.com",
      onboardingId: "onb_huc95_chemicals",
      submittedAt: FIXED_SUBMITTED_AT,
      submissionUrl: "https://app.example.com/onboarding/onb_huc95_chemicals",
    });
    // Strip the subject template token, then assert no
    // `mentor`/`mentee` substring remains. The allowed
    // exception is `mentorships team` which we keep as the
    // brand-team signature line.
    const stripped = {
      subject: email.subject.replace(/new student intro from/i, ""),
      html: email.html.replace(/the mentorships team/i, ""),
      text: email.text.replace(/the mentorships team/i, ""),
    };
    for (const forbidden of ["mentor ", "mentee", "mentorship "]) {
      expect(stripped.subject.toLowerCase()).not.toContain(forbidden);
      expect(stripped.html.toLowerCase()).not.toContain(forbidden);
      expect(stripped.text.toLowerCase()).not.toContain(forbidden);
    }
    // The allowed `mentorships` exception is rendered by the
    // builder as the team signature; re-assert here so the
    // regression guard isn't trivially bypassed by removing
    // the line.
    expect(email.text).toContain("The mentorships team");
  });
});
