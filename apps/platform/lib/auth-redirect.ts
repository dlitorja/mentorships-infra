/**
 * Post-signin destination policy for `/auth-redirect`.
 *
 * `requested` is expected to have already passed the page's
 * `whitelistedRedirectValue` guard (internal path only, no protocol-relative
 * URL, no `../` escape). This helper adds the role rule on top:
 *
 *   - Students may be sent to a validated onboarding or workspace path.
 *   - Staff (instructor / admin / support) may only be sent to a workspace
 *     path. Onboarding destinations are student-shaped.
 *
 * Keeping this pure makes the routing rule testable without mocking Clerk or
 * the Next.js request context.
 */
export function shouldHonorRequestedDestination(
  role: string,
  requested: string | null
): boolean {
  if (!requested) return false;
  if (requested.startsWith("//")) return false;
  if (requested.includes("/../")) return false;

  const isWorkspace = requested.startsWith("/workspace/");
  if (role === "student") {
    return requested.startsWith("/onboarding/") || isWorkspace;
  }
  return isWorkspace;
}
