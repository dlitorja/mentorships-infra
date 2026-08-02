import { Id } from "../../../../convex/_generated/dataModel";
import { convexServerCall } from "@/lib/convex-server-call";
import { z } from "zod";

export const clerkUserSchema = z.array(
  z.object({
    id: z.string(),
    email_addresses: z.array(
      z.object({
        email_address: z.string(),
      })
    ),
  })
);

export type ClerkUser = z.infer<typeof clerkUserSchema>[number];

export async function getInstructorNameFromClerk(
  instructorId: Id<"instructors">,
  fallbackName: string
): Promise<string> {
  try {
    const instructorName = await convexServerCall<string | null>(
      "/instructors/get-name-by-id",
      { id: instructorId }
    );
    if (!instructorName) {
      return fallbackName;
    }
    return instructorName;
  } catch {
    return fallbackName;
  }
}

export async function findClerkUserIdByEmail(email: string): Promise<string | null> {
  try {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      return null;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const queryParams = new URLSearchParams({ email_address: normalizedEmail });
    const response = await fetch(`https://api.clerk.com/v1/users?${queryParams}`, {
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const parseResult = clerkUserSchema.safeParse(json);
    if (!parseResult.success) {
      return null;
    }
    const users: ClerkUser[] = parseResult.data;
    const user = users.find((u) =>
      u.email_addresses.some((addr) => addr.email_address.toLowerCase() === normalizedEmail)
    );
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type EmailResult = { id: string | null; ok: boolean };

export function parseEmailResult(
  res: { ok: true; id: string | null } | { ok: false; skipped?: true; error?: string }
): EmailResult {
  if (res.ok) {
    return { ok: true, id: res.id ?? null };
  }
  return { ok: false, id: null };
}

export function formatPrice(amount: string | null, currency: string): string {
  if (amount === null || amount === undefined) return "N/A";
  return `${currency} ${amount}`;
}
