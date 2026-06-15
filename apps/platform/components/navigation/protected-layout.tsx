import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { MessageSquare, CalendarClock, type LucideIcon } from "lucide-react";

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
 * Shows Workspace for all users, plus role-specific navigation items:
 * - Instructors: dashboard, sessions, onboarding, settings
 * - Students: dashboard, sessions, calendar, settings
 *
 * @param children - Page content to render in the main area
 * @param currentPath - Current URL path for highlighting the active nav item
 */
export async function ProtectedLayout({ children, currentPath }: ProtectedLayoutProps) {
  const userId = await requireAuth();
  const instructorRecord = await fetchQuery(api.instructors.getInstructorByUserId, { userId });

  // Common navigation items
  const commonItems: NavItem[] = [];

  // Determine navigation items based on user role
  const roleSpecificItems: NavItem[] = instructorRecord
    ? [
        // Instructor navigation - Dashboard first, then Workspace, then instructor-specific items
        { href: "/instructor/dashboard", label: "Dashboard" },
        { href: "/workspace", label: "Workspace", icon: MessageSquare },
        { href: "/instructor/sessions", label: "My Sessions" },
        { href: "/instructor/availability", label: "Availability", icon: CalendarClock },
        { href: "/instructor/onboarding", label: "Onboarding" },
        { href: "/instructor/settings", label: "Instructor Settings" },
        { href: "/settings", label: "Settings" },
      ]
    : [
        // Student navigation - Dashboard first, then Workspace, then student-specific items
        { href: "/dashboard", label: "Dashboard" },
        { href: "/workspace", label: "Workspace", icon: MessageSquare },
        { href: "/sessions", label: "Sessions" },
        { href: "/calendar", label: "Calendar" },
        { href: "/settings", label: "Settings" },
      ];

  const navItems = [...commonItems, ...roleSpecificItems];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Sidebar */}
      <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r bg-card">
        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={currentPath === item.href ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    currentPath === item.href && "bg-secondary"
                  )}
                >
                  {Icon && <Icon className="mr-2 h-4 w-4" />}
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="ml-64">
        {/* Page Content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

