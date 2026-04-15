"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Package,
  ShoppingCart,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/instructors", label: "Instructors", icon: Users },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
];

export function ClientAdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();

  const handleSignOut = async (): Promise<void> => {
    await signOut({ redirectUrl: "/" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-muted/30 min-h-screen p-4 flex flex-col">
        <div className="mb-8">
          <h2 className="text-xl font-bold">Admin Panel</h2>
          <p className="text-sm text-muted-foreground">Web App</p>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || 
              (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-4 py-2 transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t">
          {!isLoaded ? (
            <div className="px-4 py-2 text-sm text-muted-foreground">Loading...</div>
          ) : isSignedIn ? (
            <>
              <div className="flex items-center gap-3 px-4 py-2">
                <UserButton />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-muted transition-colors text-left text-sm text-muted-foreground"
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link
              href="/sign-in"
              className="flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-muted transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </aside>

      <main className="flex-1 p-8">
        {children}
      </main>
    </div>
  );
}