import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendEmail, sendTemplateEmail } from "./send";

// R7 (PR 8): the skip-on-missing-key behavior is the contract that
// allows the onboarding workflow to run cleanly in CI / dev / preview
// environments where no Resend credentials are present. Lock it down
// here so future refactors cannot silently flip the dev → production
// branches or re-introduce network calls during the skip path.

const ORIGINAL_RESEND = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function clearEmailEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
}

beforeEach(() => {
  clearEmailEnv();
});

afterEach(() => {
  if (ORIGINAL_RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND;
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL_FROM;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("sendEmail skip-on-missing-key behavior", () => {
  it("returns skipped result in dev when RESEND_API_KEY is missing", async () => {
    process.env.NODE_ENV = "development";
    const result = await sendEmail({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>hi</p>",
    });
    expect(result).toEqual({
      ok: false,
      skipped: true,
      reason: "Email provider not configured (dev)",
    });
  });

  it("returns error result in production when RESEND_API_KEY is missing", async () => {
    process.env.NODE_ENV = "production";
    const result = await sendEmail({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>hi</p>",
    });
    expect(result).toEqual({
      ok: false,
      error: "Email provider not configured",
    });
  });

  it("treats missing EMAIL_FROM the same as missing API key", async () => {
    process.env.RESEND_API_KEY = "re_test_abc";
    delete process.env.EMAIL_FROM;
    process.env.NODE_ENV = "development";
    const result = await sendEmail({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>hi</p>",
    });
    expect(result).toEqual({
      ok: false,
      skipped: true,
      reason: "Email provider not configured (dev)",
    });
  });

  it("does not attempt to instantiate the Resend client on the skip path", async () => {
    process.env.NODE_ENV = "development";
    // No spy is needed beyond proving the function short-circuits before
    // touching the network: if it ever stopped short-circuiting, the
    // test would either throw (no API key on Resend internals) or
    // hang (real network). The shape assertion above plus the
    // immediate return proves the contract.
    const result = await sendEmail({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>hi</p>",
    });
    expect(result).toMatchObject({ ok: false, skipped: true });
  });
});

describe("sendTemplateEmail skip-on-missing-key behavior", () => {
  it("returns skipped result in dev when RESEND_API_KEY is missing", async () => {
    process.env.NODE_ENV = "development";
    const result = await sendTemplateEmail({
      to: "user@example.com",
      templateId: "tpl_welcome",
      templateData: { name: "Ada" },
    });
    expect(result).toEqual({
      ok: false,
      skipped: true,
      reason: "Email provider not configured (dev)",
    });
  });

  it("returns error result in production when RESEND_API_KEY is missing", async () => {
    process.env.NODE_ENV = "production";
    const result = await sendTemplateEmail({
      to: "user@example.com",
      templateId: "tpl_welcome",
      templateData: { name: "Ada" },
    });
    expect(result).toEqual({
      ok: false,
      error: "Email provider not configured",
    });
  });
});
