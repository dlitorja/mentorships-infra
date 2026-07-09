"use client";

import { ConvexReactClient, useConvex } from "convex/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

let convexQueryClient: ConvexQueryClient | null = null;
let convexClient: ConvexReactClient | null = null;

// `connect()` is single-use on the `ConvexQueryClient` singleton —
// we need a module-level guard because `QueryProvider` can mount
// more than once (StrictMode double-mount in dev, Next.js dev
// remounts on route change, HMR). An instance-level `useRef`
// would be reset on remount and the second `connect()` call
// would throw.
let convexQueryClientConnected = false;

if (convexUrl) {
  convexClient = new ConvexReactClient(convexUrl);
  convexQueryClient = new ConvexQueryClient(convexClient);
}

export { convexClient, convexQueryClient };

/**
 * Once Clerk populates the auth token, re-run any convex-backed
 * queries. The library's auth-token change only refreshes
 * subscriptions that are already wired; queries mounted while
 * `isAuthenticated` was false were skipped server-side and need
 * an explicit kick.
 *
 * Lives in its own component so `useConvexAuth()` is only called
 * when a `ConvexProvider` (typically `ConvexProviderWithClerk`)
 * is installed above us. In the `skipClerk` build-time branch
 * `<ConvexClientProvider>` returns a bare fragment, so
 * `useConvex()` is `undefined` and we skip mounting this child.
 */
function AuthDrivenInvalidator({ queryClient }: { queryClient: QueryClient }) {
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return first === "convexQuery" || first === "convexAction";
      },
    });
  }, [isAuthenticated, queryClient]);

  return null;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // `useConvex()` returns `undefined` when no `ConvexProvider` is
  // above us. Used as a safe probe so we don't crash on the
  // build-time `skipClerk` branch where `<ConvexClientProvider>`
  // returns a bare fragment.
  const convex = useConvex();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            queryKeyHashFn: convexQueryClient?.hashFn(),
            queryFn: convexQueryClient?.queryFn(),
            staleTime: 1000 * 60,
            // @convex-dev/react-query can throw during query removal if its
            // subscription bookkeeping has already been cleaned up. Keep entries
            // alive across normal tab/workspace switches, but still eventually GC.
            gcTime: 1000 * 60 * 60,
            retry: 3,
            refetchOnWindowFocus: true,
            refetchOnMount: true,
          },
          mutations: {
            retry: 1,
          },
        },
      })
  );

  useEffect(() => {
    if (convexQueryClient && !convexQueryClientConnected) {
      convexQueryClient.connect(queryClient);
      convexQueryClientConnected = true;
    }
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {convex ? <AuthDrivenInvalidator queryClient={queryClient} /> : null}
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
