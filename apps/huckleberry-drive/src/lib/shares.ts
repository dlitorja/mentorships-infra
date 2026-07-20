export const DEFAULT_SHARE_EXPIRES_IN_DAYS = 30;
export const SHARE_VALID_EXPIRES_IN_DAYS = [7, 30, 365, 3650] as const;

export type ShareExpiryInput = number | "never" | null | undefined;

export interface NormalizedExpiry {
  expiresAt: number | undefined;
  error?: string;
}

export function normalizeExpiresInDays(
  expiresInDays: ShareExpiryInput
): NormalizedExpiry {
  if (expiresInDays === "never") {
    return { expiresAt: undefined };
  }
  if (expiresInDays === undefined || expiresInDays === null) {
    return {
      expiresAt:
        Date.now() + DEFAULT_SHARE_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
    };
  }
  if (typeof expiresInDays !== "number" || !Number.isInteger(expiresInDays)) {
    return { expiresAt: undefined, error: "expiresInDays must be a number or \"never\"" };
  }
  if (!SHARE_VALID_EXPIRES_IN_DAYS.includes(expiresInDays as 7 | 30 | 365 | 3650)) {
    return {
      expiresAt: undefined,
      error: `expiresInDays must be one of ${SHARE_VALID_EXPIRES_IN_DAYS.join(", ")}, or the string "never"`,
    };
  }
  return {
    expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
  };
}

export function generateShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function buildShareUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set. Configure it to the public origin where recipients will open share links (e.g. https://drive.huckleberry.art)."
    );
  }
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/shared/${token}`;
}
