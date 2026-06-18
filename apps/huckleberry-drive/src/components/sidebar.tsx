"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import {
  Home,
  Upload,
  Shield,
  DollarSign,
  LogOut,
  FolderOpen,
} from "lucide-react";

type UserRole = "student" | "instructor" | "admin" | "video_editor";

interface SidebarProps {
  userRole: UserRole;
  userName?: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <Home className="w-5 h-5" /> },
  { href: "/uploads", label: "Uploads", icon: <Upload className="w-5 h-5" /> },
];

const adminNavItems: NavItem[] = [
  { href: "/admin", label: "Admin", icon: <Shield className="w-5 h-5" />, adminOnly: true },
  { href: "/admin/files", label: "Files", icon: <FolderOpen className="w-5 h-5" />, adminOnly: true },
  { href: "/admin/costs", label: "Costs", icon: <DollarSign className="w-5 h-5" />, adminOnly: true },
];

export function Sidebar({ userRole, userName }: SidebarProps): React.ReactElement {
  const pathname = usePathname();
  const { signOut } = useClerk();
  const isAdmin = userRole === "admin";

  const handleSignOut = async () => {
    await signOut({ redirectUrl: "/sign-in" });
  };

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-slate-900 text-white flex flex-col z-50">
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-xl font-bold text-emerald-400">Huckleberry Drive</h1>
        {userName && (
          <p className="text-sm text-slate-400 mt-1 truncate">{userName}</p>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="py-4">
              <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Admin
              </p>
            </div>
            {adminNavItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? "bg-purple-600 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}