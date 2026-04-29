"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstructorNavigationWrapperProps {
  currentSlug: string;
  // The instruction here is to mirror marketing's prev/next behavior.
  // We compute nav purely from sessionStorage order if available.
  // Defaults are omitted for simplicity.
}

export function InstructorNavigationWrapper({
  currentSlug,
  instructor,
  defaultNext,
  defaultPrevious,
}: InstructorNavigationWrapperProps) {
  const [order, setOrder] = useState<string[] | null>(null);

  const router = useRouter();
  const navInfoRef = useRef(navInfo);

  useEffect(() => {
    // Read custom order from session storage (slugs)
    let customOrder: string[] | undefined;
    try {
      const stored = sessionStorage.getItem('instructorOrder');
      if (stored) {
        customOrder = JSON.parse(stored);
      }
    } catch (error) {
      // Ignore errors reading from session storage
    }
    setOrder(Array.isArray(customOrder) ? customOrder : null);
    navInfoRef.current = null;

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

      if (!order || order.length === 0) return;
      const idx = order.indexOf(currentSlug);
      if (idx === -1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prevSlug = idx === 0 ? order[order.length - 1] : order[idx - 1];
        router.push(`/instructors/${prevSlug}`);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const nextSlug = idx === order.length - 1 ? order[0] : order[idx + 1];
        router.push(`/instructors/${nextSlug}`);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlug, router]);

  const currentIdx = order ? order.indexOf(currentSlug) : -1;
  const previousSlug = order && currentIdx >= 0 ? (currentIdx === 0 ? order[order.length - 1] : order[currentIdx - 1]) : null;
  const nextSlug = order && currentIdx >= 0 ? (currentIdx === order.length - 1 ? order[0] : order[currentIdx + 1]) : null;

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
          {previousSlug && (
            <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow min-w-[3rem]">
              <Link href={`/instructors/${previousSlug}`} className="flex items-center justify-center">
                <ArrowLeft className="h-5 w-5" />
                <span className="sr-only">Previous instructor</span>
              </Link>
            </Button>
          )}
          {nextSlug && (
            <Button asChild variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow min-w-[3rem]">
              <Link href={`/instructors/${nextSlug}`} className="flex items-center justify-center">
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
