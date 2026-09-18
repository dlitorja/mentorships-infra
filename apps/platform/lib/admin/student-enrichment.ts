import type { clerkClient as ClerkClientType } from "@clerk/nextjs/server";

/**
 * Clerk user IDs always start with "user_". Filter out anything that doesn't
 * match so we don't waste a Clerk API call on placeholder/invalid identifiers
 * (e.g. a session pack whose userId is an email or a legacy ID).
 */
export const CLERK_USER_ID_PREFIX = /^user_/;

export type ConvexSessionPack = {
  id: string;
  instructorId: string;
  instructorName: string | null;
  instructorSlug: string | null;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: number;
  expiresAt: number | null;
  status: string;
};

export type ConvexStudent = {
  userId: string;
  email: string | null;
  sessionPacks: ConvexSessionPack[];
};

export type EnrichedStudent = {
  userId: string;
  email: string | null;
  sessionPacks: ConvexSessionPack[];
};

export function pickPrimaryEmail(
  primaryId: string | null | undefined,
  emailAddresses: Array<{ id: string; emailAddress: string }> | undefined
): string | null {
  if (!emailAddresses || emailAddresses.length === 0) return null;
  if (primaryId) {
    const match = emailAddresses.find((e) => e.id === primaryId);
    if (match) return match.emailAddress;
  }
  return emailAddresses[0]?.emailAddress ?? null;
}

/**
 * Resolves a student's email when the Convex users table has none. Uses
 * Clerk's batch getUserList to avoid one HTTP request per missing email and
 * to stay under Clerk's rate limit (100 req / 10 s on dev, 1000 on prod).
 * Returns items in the same order/shape as the input.
 *
 * Accepts a Clerk client factory so tests can inject a mock without touching
 * module-level state. Pass `() => clerkClient()` in production.
 */
export async function enrichStudentEmails(
  students: ConvexStudent[],
  clerkClientFactory: () => Promise<Awaited<ReturnType<typeof ClerkClientType>>>
): Promise<EnrichedStudent[]> {
  if (students.length === 0) return [];

  const lookupIds = Array.from(
    new Set(
      students
        // Treat both null and empty string as "missing" so a blank Convex
        // email triggers the same Clerk fallback path.
        .filter((s) => !s.email && CLERK_USER_ID_PREFIX.test(s.userId))
        .map((s) => s.userId)
    )
  );

  let clerkEmailByUserId = new Map<string, string>();
  if (lookupIds.length > 0) {
    try {
      const clerk = await clerkClientFactory();
      const { data } = await clerk.users.getUserList({ userId: lookupIds, limit: lookupIds.length });
      for (const u of data) {
        const email = pickPrimaryEmail(u.primaryEmailAddressId, u.emailAddresses);
        if (email) clerkEmailByUserId.set(u.id, email);
      }
    } catch (clerkErr) {
      console.warn(
        "[admin/students] Failed to enrich emails from Clerk:",
        clerkErr instanceof Error ? clerkErr.message : String(clerkErr)
      );
    }
  }

  return students.map((student) => {
    // Use truthy-fallback semantics (||) so an empty-string Convex email is
    // also treated as "missing" and replaced by the Clerk-resolved value,
    // matching the lookup filter above.
    const email = student.email || clerkEmailByUserId.get(student.userId) || null;
    return {
      userId: student.userId,
      email,
      sessionPacks: student.sessionPacks ?? [],
    };
  });
}
