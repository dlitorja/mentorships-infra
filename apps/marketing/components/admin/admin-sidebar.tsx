"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Package,
  LogOut 
} from "lucide-react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/inventory", label: "Inventory", icon: Package },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { isSignedIn, user, isLoaded } = useUser();
  const router = useRouter();

  const handleSignOut = () => {
    router.push("/");
  };

  if (!isLoaded) {
    return (
      <aside className="w-64 border-r bg-muted/30 min-h-screen p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-24"></div>
          <div className="space-y-2">
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-10 bg-muted rounded"></div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r bg-muted/30 min-h-screen p-4">
      <div className="mb-8">
        <h2 className="text-xl font-bold">Admin Panel</h2>
        <p className="text-sm text-muted-foreground">Huckleberry Art</p>
      </div>

      {isSignedIn ? (
        <>
          <nav className="space-y-2 mb-8">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || 
                (item.href !== "/admin" && pathname.startsWith(item.href));
              
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

          <div className="border-t pt-4 mt-auto">
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
              <LogOut className="h-5 w-5" />
              Sign Out
            </button>
          </div>
        </>
      ) : (
        <div className="border-t pt-4 mt-auto">
          <SignInButton mode="modal">
            <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2 hover:bg-muted transition-colors">
              <LogOut className="h-5 w-5" />
              Sign In
            </button>
          </SignInButton>
        </div>
      )}
    </aside>
  );
}
