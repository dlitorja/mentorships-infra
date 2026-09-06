import { Resend } from "resend";
import { EmailKind, resolveFrom } from "../../../packages/emails/src/envelope";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /**
   * Extra headers to attach to the email.
   * Useful for provider debugging and basic correlation.
   */
  headers?: Record<string, string>;
  kind?: EmailKind;
  idempotencyKey?: string;
};

type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
  }

  return "http://localhost:3000";
}

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set (required in production)");
    }
    return null;
  }

  return new Resend(apiKey);
}

/**
 * Send a transactional email.
 *
 * Notes:
 * - In non-production environments, missing email config will skip sending.
 * - In production, missing config throws to surface misconfiguration early.
 *
 * @param args.kind - Sender purpose ("transactional" by default, "marketing", or "staging"). Picks the matching `EMAIL_FROM_*` env var so sender reputation stays isolated.
 * @param args.idempotencyKey - Optional Resend provider idempotency key.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const resend = getResendClient();
  const kind: EmailKind = args.kind ?? "transactional";
  const from = resolveFrom(kind);

  if (!resend || !from) {
    return {
      ok: false,
      skipped: true,
      reason: "Email provider not configured (missing RESEND_API_KEY and/or EMAIL_FROM)",
    };
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
      },
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    );

    return { ok: true, id: typeof result.data?.id === "string" ? result.data.id : null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type SendTemplateEmailArgs = {
  to: string;
  /** Optional subject to override template default */
  subject?: string;
  templateId: string;
  /** Variables passed to the Resend hosted template */
  templateData: Record<string, any>;
  headers?: Record<string, string>;
  kind?: EmailKind;
  idempotencyKey?: string;
};

/**
 * Send an email using a Resend hosted Template.
 * If RESEND is not configured in non-production, we skip sending.
 * If configuration is missing in production, we throw to surface misconfig.
 *
 * Important: When `template` is provided to Resend, do not pass html/text/react.
 */
export async function sendTemplateEmail(args: SendTemplateEmailArgs): Promise<SendEmailResult> {
  const resend = getResendClient();
  const kind: EmailKind = args.kind ?? "transactional";
  const from = resolveFrom(kind);

  if (!resend || !from) {
    return {
      ok: false,
      skipped: true,
      reason: "Email provider not configured (missing RESEND_API_KEY and/or EMAIL_FROM)",
    };
  }

  try {
    const result = await resend.emails.send(
      {
        from,
        to: args.to,
        subject: args.subject,
        template: {
          id: args.templateId,
          variables: args.templateData,
        },
        headers: {
          ...args.headers,
          "X-Email-Kind": kind,
        },
      } as any,
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    );

    return { ok: true, id: typeof (result as any)?.data?.id === "string" ? (result as any).data.id : null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
