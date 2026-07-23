"use client";

import React from "react";
import { Sidebar } from "./sidebar";

type UserRole = "instructor" | "admin" | "video_editor";

interface LayoutClientProps {
  children: React.ReactNode;
  userRole: UserRole | null;
  userName?: string;
}

export function LayoutClient({
  children,
  userRole,
  userName,
}: LayoutClientProps): React.ReactElement {
  return (
    <div className="flex min-h-screen">
      <Sidebar userRole={userRole} userName={userName} />
      <main className="flex-1 ml-60">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}