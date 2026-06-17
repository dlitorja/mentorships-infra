"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";

export default function Header(): React.ReactElement {
  const { user, isLoaded } = useUser();
  const pathname = usePathname();

  const navLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/uploads", label: "Upload" },
  ];

  return (
    <header className="border-b border-gray-800">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-white font-semibold hover:text-gray-300">
            Huckleberry Drive
          </Link>
          <nav className="flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-900"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {isLoaded && user && (
            <span className="text-sm text-gray-400 hidden md:block">
              {user.emailAddresses[0]?.emailAddress}
            </span>
          )}
          <UserButton />
        </div>
      </div>
    </header>
  );
}