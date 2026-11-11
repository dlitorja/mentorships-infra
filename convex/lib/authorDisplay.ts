import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/** Non-null workspace role. */
export type AuthorRole = "instructor" | "student" | "admin";

/**
 * Resolve Clerk subjects to human display names for workspace content.
 *
 * Policy (shared by chat, notes, and now exports):
 * - instructor authors render as the instructor profile's `name`
 *   (never their email),
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
      const userName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
      const displayName =
        (role === "instructor" ? instructor?.name?.trim() : undefined) ||
        userName ||
        (role === "admin" ? "Admin" : role === "instructor" ? "Instructor" : "Student");
      return [author.userId, displayName] as const;
    })
  );
  return new Map(resolved);
}
