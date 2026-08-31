import Link from "next/link";
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
  const token = await getConvexAuthToken();
  const instructorRecord = token
    ? await fetchQuery(api.instructors.getInstructorByUserId, { userId }, { token })
    : null;

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
        <main className="p-6">{children}</main>
      </div>

      {/* PR #4c-2: invisible global listener that fires Sonner toasts
       * + optional sound/desktop when a new ad-hoc call invite
       * notification arrives. Renders nothing — pure side effect. */}
      <IncomingCallToast />
    </div>
  );
}

