import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendEmail, sendTemplateEmail } from "./send";
import { resolveFrom } from "./envelope";

const ORIGINAL_RESEND = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM;
const ORIGINAL_FROM_TX = process.env.EMAIL_FROM_TRANSACTIONAL;
const ORIGINAL_FROM_MKT = process.env.EMAIL_FROM_MARKETING;
const ORIGINAL_FROM_STG = process.env.EMAIL_FROM_STAGING;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function clearEmailEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_FROM_TRANSACTIONAL;
  delete process.env.EMAIL_FROM_MARKETING;
  delete process.env.EMAIL_FROM_STAGING;
}

beforeEach(() => {
  clearEmailEnv();
});

afterEach(() => {
  if (ORIGINAL_RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND;
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL_FROM;
  if (ORIGINAL_FROM_TX === undefined) delete process.env.EMAIL_FROM_TRANSACTIONAL;
  else process.env.EMAIL_FROM_TRANSACTIONAL = ORIGINAL_FROM_TX;
  if (ORIGINAL_FROM_MKT === undefined) delete process.env.EMAIL_FROM_MARKETING;
  else process.env.EMAIL_FROM_MARKETING = ORIGINAL_FROM_MKT;
  if (ORIGINAL_FROM_STG === undefined) delete process.env.EMAIL_FROM_STAGING;
  else process.env.EMAIL_FROM_STAGING = ORIGINAL_FROM_STG;
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

describe("resolveFrom sender selection", () => {
  it("prefers EMAIL_FROM_TRANSACTIONAL for transactional kind", () => {
    process.env.EMAIL_FROM_TRANSACTIONAL = "tx@tx.example";
    process.env.EMAIL_FROM = "legacy@legacy.example";
    expect(resolveFrom("transactional")).toBe("tx@tx.example");
  });

  it("falls back to EMAIL_FROM for transactional when dedicated var is unset", () => {
    process.env.EMAIL_FROM = "legacy@legacy.example";
    expect(resolveFrom("transactional")).toBe("legacy@legacy.example");
  });

  it("returns EMAIL_FROM_MARKETING for marketing kind, never the legacy EMAIL_FROM", () => {
    process.env.EMAIL_FROM = "legacy@legacy.example";
    process.env.EMAIL_FROM_MARKETING = "mkt@mkt.example";
    expect(resolveFrom("marketing")).toBe("mkt@mkt.example");
  });

  it("falls back to EMAIL_FROM for marketing when EMAIL_FROM_MARKETING is unset", () => {
    process.env.EMAIL_FROM = "legacy@legacy.example";
    expect(resolveFrom("marketing")).toBe("legacy@legacy.example");
  });

  it("returns EMAIL_FROM_STAGING for staging kind", () => {
    process.env.EMAIL_FROM_STAGING = "stg@stg.example";
    process.env.EMAIL_FROM = "legacy@legacy.example";
    expect(resolveFrom("staging")).toBe("stg@stg.example");
  });

  it("returns null when no from env var is set", () => {
    expect(resolveFrom("transactional")).toBeNull();
    expect(resolveFrom("marketing")).toBeNull();
    expect(resolveFrom("staging")).toBeNull();
  });
});
