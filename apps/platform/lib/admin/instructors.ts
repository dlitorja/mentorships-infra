import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Use `unknown` instead of `any` to preserve null checks at call sites
type Resolved = { instructor: unknown | null; resolvedId: string | null };

/**
 * Resolve an instructor by Convex document id or slug.
 * Only swallows errors related to invalid id formats; network/auth errors are rethrown.
 */
export async function resolveInstructorByIdOrSlug(
  convex: ConvexHttpClient,
  idOrSlug: string
): Promise<Resolved> {
  // Try Convex Id first; if invalid, swallow and continue to slug
  try {
    const byId = await convex.query(api.instructors.getInstructorById, { id: idOrSlug as any });
    if (byId) {
      return { instructor: byId, resolvedId: (byId as any)._id as string };
    }
  } catch (err) {
    if (!(err instanceof Error) || !/id|argument/i.test(err.message)) {
      // Network/auth or unexpected error: propagate
      throw err;
    }
  }

  // Fallback: treat the param as slug
  const bySlug = await convex.query(api.instructors.getInstructorBySlugForAdmin, { slug: idOrSlug });
  if (bySlug) {
    return { instructor: bySlug, resolvedId: (bySlug as any)._id as string };
  }

  return { instructor: null, resolvedId: null };
}
