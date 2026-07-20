export function generateShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function buildShareUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://drive.huckleberry.art";
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/shared/${token}`;
}

export const DEFAULT_SHARE_EXPIRES_IN_DAYS = 30;
