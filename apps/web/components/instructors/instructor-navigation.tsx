"use client";

interface InstructorNavigationProps {
  previousSlug: string | null;
  nextSlug: string | null;
  children: React.ReactNode;
}

/**
 * InstructorNavigation wrapper component
 * Note: Keyboard navigation is now handled by InstructorNavigationWrapper
 * which has access to dynamic order from session storage
 */
export function InstructorNavigation({
  previousSlug,
  nextSlug,
  children,
}: InstructorNavigationProps) {
  // Keyboard navigation is handled by InstructorNavigationWrapper
  // This component is kept for backwards compatibility and potential future use
  return <>{children}</>;
}

