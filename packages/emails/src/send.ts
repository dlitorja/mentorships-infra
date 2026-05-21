import { Resend } from "resend";

export type SendEmailArgs = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
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

function getFromAddress(): string | null {
  return process.env.EMAIL_FROM || null;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const resend = getResendClient();
  const from = getFromAddress();
  if (!resend || !from) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Email provider not configured" };
    }
    return { ok: false, skipped: true, reason: "Email provider not configured (dev)" };
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
    } as any);

    return { ok: true, id: typeof (result as any)?.data?.id === "string" ? (result as any).data.id : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendTemplateEmail(args: {
  to: string;
  subject?: string;
  templateId: string;
  templateData: Record<string, any>;
  headers?: Record<string, string>;
}): Promise<SendEmailResult> {
  const resend = getResendClient();
  const from = getFromAddress();
  if (!resend || !from) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Email provider not configured" };
    }
    return { ok: false, skipped: true, reason: "Email provider not configured (dev)" };
  }

  try {
    const result = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      template: { id: args.templateId, variables: args.templateData },
      headers: args.headers,
    } as any);
    return { ok: true, id: typeof (result as any)?.data?.id === "string" ? (result as any).data.id : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function formatSessionDateTime(date: Date, timeZone?: string): string {
  const tz = timeZone || "UTC";
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
}
