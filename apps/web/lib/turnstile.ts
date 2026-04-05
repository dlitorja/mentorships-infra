import { z } from "zod";

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

const siteVerifySchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
  action: z.string().optional(),
  cdata: z.string().optional(),
});

export async function verifyTurnstileToken(
  token: string,
  ip?: string
): Promise<boolean> {
  if (!token || !TURNSTILE_SECRET_KEY) {
    return false;
  }

  const formData = new FormData();
  formData.append("secret", TURNSTILE_SECRET_KEY);
  formData.append("response", token);

  if (ip) {
    formData.append("remoteip", ip);
  }

  try {
    const result = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      }
    );

    const parsed = siteVerifySchema.safeParse(await result.json());
    if (!parsed.success) {
      return false;
    }
    return parsed.data.success === true;
  } catch {
    return false;
  }
}

export function getClientIp(req: Request): string | undefined {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}
