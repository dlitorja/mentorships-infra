"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInstructorNavigation } from "@/lib/instructors";
import type { Instructor } from "@/lib/instructors";

interface InstructorNavigationWrapperProps {
  currentSlug: string;
  defaultNext?: Instructor | null;
  defaultPrevious?: Instructor | null;
}

export function InstructorNavigationWrapper({
  currentSlug,
  defaultNext,
  defaultPrevious,
}: InstructorNavigationWrapperProps): React.JSX.Element {
  const [navInfo, setNavInfo] = useState<{
    next: Instructor | undefined;
    previous: Instructor | undefined;
    currentIndex: number;
    totalCount: number;
    mode: 'custom' | 'alphabetical';
  } | null>(null);

  const router = useRouter();
  const navInfoRef = useRef(navInfo);

  useEffect(() => {
    // Read custom order from session storage
    let customOrder: string[] | undefined;
    try {
      const stored = sessionStorage.getItem('instructorOrder');
      if (stored) {
        customOrder = JSON.parse(stored);
      }
    } catch (error) {
      // Ignore errors reading from session storage
    }

    const navigation = getInstructorNavigation(currentSlug, customOrder);
    setNavInfo(navigation);
    navInfoRef.current = navigation; // Keep ref in sync with state

    // Handle keyboard navigation
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

      const currentNavigation = navInfoRef.current; // Use ref for latest state
      if (e.key === "ArrowLeft" && currentNavigation?.previous) {
        e.preventDefault();
        router.push(`/instructors/${currentNavigation.previous.slug}`);
      } else if (e.key === "ArrowRight" && currentNavigation?.next) {
        e.preventDefault();
        router.push(`/instructors/${currentNavigation.next.slug}`);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlug, router]);

  // Use client-side navigation if available, otherwise fall back to server-side defaults
  const nextInstructor = navInfo?.next ?? defaultNext ?? null;
  const previousInstructor = navInfo?.previous ?? defaultPrevious ?? null;

  return (
    <>
      {/* Navigation Header */}
      <div className="mb-8 flex items-center justify-center gap-4">
        <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow">
          <Link href="/instructors" className="flex items-center gap-2">
            ← View All Instructors
          </Link>
        </Button>
        
        <div className="flex items-center gap-3">
          {previousInstructor && (
            <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow min-w-[3rem]">
              <Link href={`/instructors/${previousInstructor.slug}`} className="flex items-center justify-center">
                <ArrowLeft className="h-5 w-5" />
                <span className="sr-only">Previous instructor</span>
              </Link>
            </Button>
          )}
          {nextInstructor && (
            <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow min-w-[3rem]">
              <Link href={`/instructors/${nextInstructor.slug}`} className="flex items-center justify-center">
                <ArrowRight className="h-5 w-5" />
                <span className="sr-only">Next instructor</span>
              </Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

