"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface InstructorNavigationProps {
  previousSlug: string | null;
  nextSlug: string | null;
  children: React.ReactNode;
}

export function InstructorNavigation({
  previousSlug,
  nextSlug,
  children,
}: InstructorNavigationProps) {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle arrow keys if user is typing in an input, textarea, or if a dialog/modal is open
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }

      if (e.key === "ArrowLeft" && previousSlug) {
        e.preventDefault();
        router.push(`/instructors/${previousSlug}`);
      } else if (e.key === "ArrowRight" && nextSlug) {
        e.preventDefault();
        router.push(`/instructors/${nextSlug}`);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router, previousSlug, nextSlug]);

  return <>{children}</>;
}

