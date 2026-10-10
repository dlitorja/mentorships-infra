import { Resend } from "resend";
import { EmailKind, resolveFrom } from "./envelope";

export type SendEmailArgs = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  kind?: EmailKind;
  idempotencyKey?: string;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) return process.env.NEXT_PUBLIC_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Base URL not configured. Set NEXT_PUBLIC_URL (or VERCEL_URL) for emails.");
  }
  return "http://localhost:3000";
}

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

/**
 * Sends an email using Resend.
 * In production, returns the email ID on success. In development without API key, returns a skipped result.
 *
 * @param args.to - Recipient email address
 * @param args.subject - Email subject line
 * @param args.html - HTML body content
 * @param args.text - Plain text body content
 * @param args.replyTo - Optional reply-to address
 * @param args.headers - Optional custom headers
 * @param args.kind - Sender purpose: "transactional" (default), "marketing", or "staging". Picks the matching `EMAIL_FROM_*` env var so sender reputation stays isolated across streams.
 * @param args.idempotencyKey - Optional Resend provider idempotency key, forwarded to the API call.
 * @returns Result object with ok flag, email ID on success, or error/skipped reason
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const resend = getResendClient();
  const kind: EmailKind = args.kind ?? "transactional";
  const from = resolveFrom(kind);
  if (!resend || !from) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Email provider not configured" };
    }
    return { ok: false, skipped: true, reason: "Email provider not configured (dev)" };
  }

  const replyTo = args.replyTo || process.env.EMAIL_REPLY_TO || undefined;

  try {
    const result = await resend.emails.send(
      {
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        replyTo,
        headers: {
          ...args.headers,
          "X-App-Base-Url": getBaseUrl(),
          "X-Email-Kind": kind,
        },
      } as any,
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    );

    // Greptile round-27 P1 #13: Resend returns
    // { data, error } on every response. If the call
    // succeeded but error is set (rate limit, bad
    // recipient, etc.) the SDK doesn't throw — and the
    // previous code returned { ok: true, id: null } for
    // any non-throwing result. Callers (notably the
    // onboarding-reminder cron) treated ok=true as
    // 'sent' and advanced the reminder counter, so a
    // failing Resend call exhausted all three reminders
    // without ever delivering an email.
    const resendError = (result as any)?.error;
    if (resendError) {
      const message =
        typeof resendError === "string"
          ? resendError
          : typeof resendError?.message === "string"
            ? resendError.message
            : "Resend returned an error";
      return { ok: false, error: message };
    }
    const id =
      typeof (result as any)?.data?.id === "string"
        ? (result as any).data.id
        : null;
    // Greptile round-27 P1 #13: also reject an
    // 'ok:true' result with no id. The Resend SDK
    // contract is that a successful send returns a
    // data.id; absent that, the send was either lost
    // or queued for retry — neither is good enough to
    // call it a successful delivery.
    if (!id) {
      return { ok: false, error: "Resend returned no email id" };
    }
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Sends an email using a Resend template.
 * In production, returns the email ID on success. In development without API key, returns a skipped result.
 *
 * @param args.to - Recipient email address
 * @param args.subject - Optional email subject line (uses template default if omitted)
 * @param args.templateId - Resend template identifier
 * @param args.templateData - Key-value pairs for template variables
 * @param args.headers - Optional custom headers
 * @param args.kind - Sender purpose (see sendEmail). Defaults to "transactional".
 * @param args.idempotencyKey - Optional Resend provider idempotency key.
 * @returns Result object with ok flag, email ID on success, or error/skipped reason
 */
export async function sendTemplateEmail(args: {
  to: string;
  subject?: string;
  templateId: string;
  templateData: Record<string, any>;
  headers?: Record<string, string>;
  kind?: EmailKind;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  const resend = getResendClient();
  const kind: EmailKind = args.kind ?? "transactional";
  const from = resolveFrom(kind);
  if (!resend || !from) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Email provider not configured" };
    }
    return { ok: false, skipped: true, reason: "Email provider not configured (dev)" };
  }

  try {
    const result = await resend.emails.send(
      {
        from,
        to: args.to,
        subject: args.subject,
        template: { id: args.templateId, variables: args.templateData },
        headers: { ...args.headers, "X-Email-Kind": kind },
      } as any,
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    );
    // Greptile round-27 P1 #13: same fix as sendEmail —
    // reject results with an error field or no email id,
    // so callers don't advance delivery counters on
    // undelivered sends.
    const resendError = (result as any)?.error;
    if (resendError) {
      const message =
        typeof resendError === "string"
          ? resendError
          : typeof resendError?.message === "string"
            ? resendError.message
            : "Resend returned an error";
      return { ok: false, error: message };
    }
    const id =
      typeof (result as any)?.data?.id === "string"
        ? (result as any).data.id
        : null;
    if (!id) {
      return { ok: false, error: "Resend returned no email id" };
    }
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Formats a date/time for display in email templates.
 * Formats as a human-readable string with weekday, full month, day, year, and time with timezone abbreviation.
 *
 * @param date - The Date object to format
 * @param timeZone - Optional IANA timezone (e.g., "America/New_York"). Defaults to UTC.
 * @returns Formatted string like "Monday, January 15, 2026 at 2:30 PM EST"
 */
export function formatSessionDateTime(date: Date, timeZone?: string): string {
  const tz = timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }
}
