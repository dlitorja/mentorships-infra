import {
  verifyTurnstileToken as sharedVerify,
  getClientIp as sharedGetClientIp,
  type TurnstileVerificationResult,
  type VerifyTurnstileTokenOptions,
} from "@mentorships/security";

export type { TurnstileVerificationResult, VerifyTurnstileTokenOptions };

export async function verifyTurnstileToken(
  token: string,
  ip?: string
): Promise<boolean> {
  const result = await sharedVerify(token, { remoteIp: ip });
  return result.success;
}

export function getClientIp(req: Request): string | undefined {
  return sharedGetClientIp(req);
}
