'use client';

import { ReactElement, ReactNode } from 'react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { useAuth } from '@clerk/nextjs';
import { convexClient } from '@/lib/providers/query-provider';

interface ConvexClientProviderProps {
  children: ReactNode;
  skipClerk?: boolean;
}

export default function ConvexClientProvider({
  children,
  skipClerk = false
}: ConvexClientProviderProps): ReactElement {
  if (!convexClient || skipClerk) {
    return <>{children}</>;
  }

  return (
    <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
