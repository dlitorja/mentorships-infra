import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/** Non-null workspace role. */
export type AuthorRole = "instructor" | "student" | "admin";

/**
 * True when a stored display name is actually an email address.
 *
 * Invitation acceptance creates instructor profiles with
 * `name: invitation.email`, so `instructors.name` is not guaranteed to
 * be a human name. Rendering it verbatim would leak the instructor's
 * email into student-visible surfaces (chat author labels, the links
 * CSV).
 */
function looksLikeEmail(value: string | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Resolve Clerk subjects to human display names for workspace content.
 *
 * Policy (shared by chat, notes, and exports):
 * - instructor authors render as the instructor profile's `name`
 *   (never their email — a name stored as an email is rejected),
 * - everyone else renders as their user first + last name,
 * - fall back to a role label ("Student" / "Instructor" / "Admin")
 *   rather than an email or a Clerk id.
 *
 * `author.role` can be supplied when the caller already knows it (e.g.
 * a stored `senderRole`); otherwise it is derived from the user row and
 * the workspace's instructor link.
 */
export async function resolveAuthorDisplayNames(
  ctx: QueryCtx,
  workspace: Pick<Doc<"workspaces">, "instructorId">,
  authors: Array<{ userId: string; role?: AuthorRole }>
): Promise<Map<string, string>> {
  const uniqueAuthors = new Map(authors.map((author) => [author.userId, author]));
  const resolved = await Promise.all(
    [...uniqueAuthors.values()].map(async (author) => {
      const [user, instructor] = await Promise.all([
        ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", author.userId))
          .first(),
        ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", author.userId))
          .first(),
      ]);
      const role: AuthorRole =
        author.role ??
        (user?.role === "admin"
          ? "admin"
          : instructor && instructor._id === workspace.instructorId
            ? "instructor"
            : "student");
      const rawInstructorName = instructor?.name?.trim();
      const instructorName =
        rawInstructorName && !looksLikeEmail(rawInstructorName)
          ? rawInstructorName
          : undefined;
      const rawUserName = [user?.firstName, user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const userName = rawUserName && !looksLikeEmail(rawUserName) ? rawUserName : undefined;
      const displayName =
        (role === "instructor" ? instructorName : undefined) ||
        userName ||
        (role === "admin" ? "Admin" : role === "instructor" ? "Instructor" : "Student");
      return [author.userId, displayName] as const;
    })
  );
  return new Map(resolved);
}
