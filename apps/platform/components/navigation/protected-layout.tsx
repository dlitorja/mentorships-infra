import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { requireAuth } from "@/lib/auth";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  MessageSquare,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { IncomingCallToast } from "@/components/notifications/incoming-call-toast";
import { OnboardingGateBanner } from "@/components/onboarding/onboarding-gate-banner";
import type { StudentOnboardingGateEnvelope } from "@/components/onboarding/onboarding-gate-banner";

interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
}

interface ProtectedLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

/**
 * Server component providing a fixed sidebar navigation for authenticated users.
 * For instructors and students only the two primary surfaces are exposed:
 * Workspace (top) and Dashboard (underneath). Other instructor/student pages are
 * hidden while those parts of the app are further developed.
 *
 * @param children - Page content to render in the main area
 * @param currentPath - Current URL path for highlighting the active nav item
 */
export async function ProtectedLayout({ children, currentPath }: ProtectedLayoutProps) {
  const userId = await requireAuth();
  const sessionAuth = await auth();
  const token = await getConvexAuthToken();
  const instructorRecord = token
    ? await fetchQuery(api.instructors.getInstructorByUserId, { userId }, { token })
    : null;

  // Greptile P2 follow-up: read the role from the Clerk session claim
  // so we can decide whether the gate even fires. Mirrors
  // `proxy.ts`'s role-default-to-student fallback for legacy accounts
  // (`getServerUserRole` in `lib/auth-helpers.ts`).
  const claimsRoleMetadata = (
    sessionAuth.sessionClaims?.publicMetadata as Record<string, unknown> | undefined
  )?.role;
  const claimsRole =
    typeof claimsRoleMetadata === "string" ? claimsRoleMetadata : undefined;
  // Mirror `getServerUserRole`: a missing role claim default to
  // "student" so the gate treats legacy / admin-created accounts
  // as students. Widen via `instructorRecord` for verified
  // instructors regardless of claim state.
  const likelyRole: "student" | "instructor" | "admin" | "other" =
    instructorRecord
      ? "instructor"
      : claimsRole === "admin"
        ? "admin"
        : claimsRole === "instructor"
          ? "instructor"
          : "student";

  // PR 12 PR E (Follow-up) — Soft gate: server-side prefetch the
  // onboarding gate envelope so it lands in the React Query cache
  // before the client banner reads it. The hard gate (proxy.ts
  // 307 redirect) is the source of truth for navigation; this
  // banner is the in-app affordance once a gated student reaches
  // an allowed page (dashboard, browse-instructors, settings/identity).
  //
  // The query is READ-ONLY (Convex queries can't run mutations),
  // so we self-heal via the public mutation FIRST so a freshly-
  // signed-up student whose Clerk webhook hasn't landed yet still
  // gets matched to their `adminOnboardings` row. The mutation
  // is idempotent on `(email, clerkUserId)` per HUC-92.
  //
  // Greptile P2 follow-up: only fetch the student-shape envelope
  // for users whose role is "student". Instructors and admins
  // can have a historical unfinished onboarding in their account
  // (e.g. they were once an admin-onboarding-targeted "student"
  // before promotion) and we don't want to render a "Finish
  // onboarding" banner on their workspace pages.
  //
  // Best-effort fetch with a deadline — wraps the claim+query
  // round-trip in a Promise.race so a slow Convex response
  // (proxy.ts already gave up after 800ms) doesn't drag the
  // page render here. Default envelope = "no gate" so the
  // banner stays hidden without an explicit decision.
  //
  // Greptile round-9 P2: `TEST_WEBHOOK_BYPASS=true` short-circuits
  // BOTH the proxy.ts redirect AND every soft surface. Kernel-
  // backed Playwright E2E runs flow through the platform without a
  // finished onboarding row; previously the banner + dashboard
  // welcome card still rendered against an active gate and
  // confused the test reporter. We mirror the proxy.ts env-var
  // check at the top of this layout so test users never see
  // either reminder.
  const isTestWebhookBypass = process.env.TEST_WEBHOOK_BYPASS === "true";
  const SAFE_DEFAULT: StudentOnboardingGateEnvelope = {
    requiresOnboardingCompletion: false,
    onboardingId: null,
    rowStatus: null,
    questionnaireSubmitted: true,
    reason: null,
  };
  const gate: StudentOnboardingGateEnvelope =
    isTestWebhookBypass
      ? SAFE_DEFAULT
      : token && likelyRole === "student"
        ? await (async () => {
            const TIMEOUT_MS = 800;
            // Greptile P1 follow-up: any thrown error inside the
            // lookup must not break the protected page — the gate is
            // a soft affordance. Wrap the whole race in a try/catch
            // that always falls through to SAFE_DEFAULT.
            try {
              const fallbackPromise = new Promise<StudentOnboardingGateEnvelope>(
                (resolve) => setTimeout(() => resolve(SAFE_DEFAULT), TIMEOUT_MS),
              );
              const gatePromise = (async (): Promise<StudentOnboardingGateEnvelope> => {
                try {
                  const { fetchMutation } = await import("convex/nextjs");
                  await fetchMutation(
                    api.adminOnboarding.claimOnboardingByEmailForCurrentUser,
                    {},
                    { token }
                  );
                } catch {
                  // best-effort claim; fall through to query anyway
                }
                return (await fetchQuery(
                  api.adminOnboarding.getStudentOnboardingGateForCurrentUser,
                  {},
                  { token }
                )) as StudentOnboardingGateEnvelope;
              })();
              return await Promise.race<StudentOnboardingGateEnvelope>([
                gatePromise,
                fallbackPromise,
              ]);
            } catch {
              return SAFE_DEFAULT;
            }
          })()
        : SAFE_DEFAULT;

  // Workspace is always the first/top nav item, followed by the role-specific
  // dashboard. Instructor/student-specific pages are intentionally hidden while
  // those surfaces are further developed.
  const dashboardHref = instructorRecord ? "/instructor/dashboard" : "/dashboard";
  const navItems: NavItem[] = [
    { href: "/workspace", label: "Workspace", icon: MessageSquare },
    { href: dashboardHref, label: "Dashboard", icon: LayoutDashboard },
  ];

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-background">
      {/* Navigation Sidebar */}
      <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r bg-card flex flex-col">
        <nav className="p-4 space-y-2 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPath === item.href || currentPath?.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    isActive && "bg-secondary"
                  )}
                >
                  {Icon && <Icon className="mr-2 h-4 w-4" />}
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
        {/* PR #4c-2: notification bell pinned to the bottom of the
         * sidebar so it's visible on every protected page (dashboard,
         * workspace, settings, instructor pages). Pairs with the
         * per-workspace row badge in the workspace picker for the
         * cross-workspace rollup. */}
        <div className="p-4 border-t flex justify-end">
          <NotificationBell />
        </div>
      </aside>

      {/* Main Content */}
      <div className="ml-64">
        {/* Page Content */}
        <main className="p-6">
          {/* PR 12 PR E (Follow-up) — Soft-gate banner above page
           * children so a gated student sees the unfinished-
           * onboarding message inside every protected surface
           * (workspace, settings, sessions, calendar). The hard
           * 307 in proxy.ts is the source of truth for
           * navigation; this banner is the in-app nudge.
           *
           * PR 14 — Suppress the banner on the onboarding routes
           * themselves. The student is already inside the funnel
           * (`/onboarding/[id]/questionnaire` IS the form whose
           * "Finish onboarding" CTA would just link back to the
           * same page). The banner copy — "One last step before we
           * can set up your session" — also reads as condescending
           * from where the student is currently working. So skip
           * on every path under `/onboarding/...` and let the page
           * itself own the messaging. Instructors/admins landing
           * on the staff status page render unchanged because they
           * are not gated by `gate.requiresOnboardingCompletion`.
           *
           * Greptile P2 #1 — `/onboarding/[id]/questionnaire/page.tsx`
           * passes `currentPath="/onboarding"` (the bare section
           * prefix) instead of a fully-qualified page path. The
           * suppression must match BOTH the section root AND any
           * child route so a page that only has the section name
           * still keeps the banner quiet — without it, a student
           * inside the funnel would re-trigger the same message
           * they're already answering on the form.
           */}
          {!currentPath?.startsWith("/onboarding") && (
            <OnboardingGateBanner gate={gate} />
          )}
          {children}
        </main>
      </div>

      {/* PR #4c-2: invisible global listener that fires Sonner toasts
       * + optional sound/desktop when a new ad-hoc call invite
       * notification arrives. Renders nothing — pure side effect. */}
      <IncomingCallToast />
    </div>
  );
}

