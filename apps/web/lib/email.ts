import { Resend } from "resend";

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

function getFromAddress(): string | null {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_FROM is not set (required in production)");
    }
    return null;
  }
  return from;
}

/**
 * Send a transactional email.
 *
 * Notes:
 * - In non-production environments, missing email config will skip sending.
 * - In production, missing config throws to surface misconfiguration early.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const resend = getResendClient();
  const from = getFromAddress();

  if (!resend || !from) {
    return {
      ok: false,
      skipped: true,
      reason: "Email provider not configured (missing RESEND_API_KEY and/or EMAIL_FROM)",
    };
  }

  const replyTo = args.replyTo || process.env.EMAIL_REPLY_TO || undefined;

  try {
    const result = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo,
      headers: {
        ...args.headers,
        "X-App-Base-Url": getBaseUrl(),
      },
    });

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
  const from = getFromAddress();

  if (!resend || !from) {
    return {
      ok: false,
      skipped: true,
      reason: "Email provider not configured (missing RESEND_API_KEY and/or EMAIL_FROM)",
    };
  }

  try {
    const result = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject, // optional override; template default used if undefined
      // Resend hosted template usage (Context7 docs):
      // https://resend.com/docs/dashboard/templates/introduction
      template: {
        id: args.templateId,
        variables: args.templateData,
      },
      headers: {
        ...args.headers,
        "X-App-Base-Url": getBaseUrl(),
      },
    } as any);

    return { ok: true, id: typeof (result as any)?.data?.id === "string" ? (result as any).data.id : null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
