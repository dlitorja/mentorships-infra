import Link from "next/link";
import { requireDbUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMentorByUserId } from "@mentorships/db";

interface ProtectedLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

export async function ProtectedLayout({ children, currentPath }: ProtectedLayoutProps) {
  const user = await requireDbUser();
  const mentor = await getMentorByUserId(user.id);

  // Determine navigation items based on user role
  const navItems = mentor
    ? [
        // Instructor navigation
        { href: "/instructor/dashboard", label: "Instructor Dashboard" },
        { href: "/instructor/sessions", label: "My Sessions" },
        { href: "/settings", label: "Settings" },
      ]
    : [
        // Student navigation
        { href: "/dashboard", label: "Dashboard" },
        { href: "/sessions", label: "Sessions" },
        { href: "/calendar", label: "Calendar" },
        { href: "/settings", label: "Settings" },
      ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation Sidebar */}
      <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r bg-card">
        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Button
                variant={currentPath === item.href ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start",
                  currentPath === item.href && "bg-secondary"
                )}
              >
                {item.label}
              </Button>
            </Link>
          ))}
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

