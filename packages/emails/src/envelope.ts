export type EmailKind = "transactional" | "marketing" | "staging";

export function resolveFrom(kind: EmailKind): string | null {
  if (kind === "marketing") {
    return process.env.EMAIL_FROM_MARKETING ?? process.env.EMAIL_FROM ?? null;
  }
  if (kind === "staging") {
    return process.env.EMAIL_FROM_STAGING ?? process.env.EMAIL_FROM ?? null;
  }
  return process.env.EMAIL_FROM_TRANSACTIONAL ?? process.env.EMAIL_FROM ?? null;
}
