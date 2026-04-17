'use client';

import { ReactElement, ReactNode } from 'react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { useAuth } from '@clerk/nextjs';

interface ConvexClientProviderProps {
  children: ReactNode;
  skipClerk?: boolean;
}

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Only create the client if the URL is defined (runtime only)
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function ConvexClientProvider({ 
  children, 
  skipClerk = false 
}: ConvexClientProviderProps): ReactElement {
  // During static generation or when URL is not set, render children without Convex
  // Also skip Clerk integration if skipClerk is true (build-time scenario)
  if (!convex || skipClerk) {
    return <>{children}</>;
  }

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
