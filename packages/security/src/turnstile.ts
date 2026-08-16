import { z } from "zod";

const siteVerifySchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
  action: z.string().optional(),
  cdata: z.string().optional(),
});

export interface TurnstileVerificationResult {
  success: boolean;
  errorCodes?: string[];
  hostname?: string;
  action?: string;
}

export interface VerifyTurnstileTokenOptions {
  secretKey?: string;
  remoteIp?: string;
  /**
   * When provided, the verification fails unless Cloudflare's response includes
   * this exact action. Use this to prevent cross-widget token reuse.
   */
  action?: string;
}

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token.
 *
 * @param token The Turnstile response token from the client.
 * @param options Optional secret key (defaults to TURNSTILE_SECRET_KEY env var) and remote IP.
 * @returns The verification result, including success status and any error codes.
 */
export async function verifyTurnstileToken(
  token: string,
  options: VerifyTurnstileTokenOptions = {}
): Promise<TurnstileVerificationResult> {
  const secretKey = options.secretKey ?? process.env.TURNSTILE_SECRET_KEY;

  if (!token || !secretKey) {
    return { success: false };
  }

  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);

  if (options.remoteIp) {
    formData.append("remoteip", options.remoteIp);
  }

  try {
    const result = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: formData,
    });

    const parsed = siteVerifySchema.safeParse(await result.json());
    if (!parsed.success) {
      return { success: false };
    }

    const success =
      parsed.data.success === true &&
      (!options.action || parsed.data.action === options.action);

    return {
      success,
      errorCodes: parsed.data["error-codes"],
      hostname: parsed.data.hostname,
      action: parsed.data.action,
    };
  } catch {
    return { success: false };
  }
}

/**
 * Extract the client IP address from common proxy headers.
 */
export function getClientIp(req: Request): string | undefined {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}

/**
 * Convenience helper that returns `true` only when the token is verified.
 */
export async function isTurnstileTokenValid(
  token: string,
  options?: VerifyTurnstileTokenOptions
): Promise<boolean> {
  const result = await verifyTurnstileToken(token, options);
  return result.success === true;
}
