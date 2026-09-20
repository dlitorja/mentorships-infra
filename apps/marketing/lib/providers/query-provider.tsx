"use client";

import { ConvexReactClient, useConvex } from "convex/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useConvexAuth } from "convex/react";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";

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
const SYNCABLE_ROLES = ["student", "instructor", "admin", "video_editor"] as const;
type SyncableRole = (typeof SYNCABLE_ROLES)[number];

function isSyncableRole(value: unknown): value is SyncableRole {
  return typeof value === "string" && (SYNCABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Once Clerk populates the auth token:
 *   1. Sync the Clerk `publicMetadata.role` claim to the Convex
 *      `users.role` field. Convex admin queries check `users.role`,
 *      not Clerk claims directly, so an out-of-sync record returns
 *      empty/Forbidden even for legitimate admins.
 *   2. Re-run any convex-backed queries (the auth-token change only
 *      refreshes subscriptions that were already wired; queries
 *      mounted while `isAuthenticated` was false need an explicit
 *      kick).
 *
 * Lives in its own component so `useConvexAuth()` + `useMutation()`
 * are only called when a `ConvexProvider` (typically
 * `ConvexProviderWithClerk`) is installed above us. In the
 * `skipClerk` build-time branch `<ConvexClientProvider>` returns
 * a bare fragment, so `useConvex()` is `undefined` and we skip
 * mounting this child.
 */
function AuthDrivenInvalidator({ queryClient }: { queryClient: QueryClient }) {
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();
  const { userId, sessionClaims, isLoaded: clerkLoaded } = useClerkAuth();

  // Track the last `(userId, role)` tuple we successfully synced so we
  // re-sync when EITHER changes (e.g., Clerk flips admin → student, or
  // a different account signs in without a full page reload). A simple
  // boolean `syncedRef` would miss role downgrades and stale accounts.
  const lastSyncedRef = useRef<{ userId: string; role: SyncableRole | null } | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (convexAuthLoading || !clerkLoaded) return;
    if (!isAuthenticated || !userId) return;

    const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
    const role: SyncableRole | null = isSyncableRole(claimsRole) ? claimsRole : null;

    const last = lastSyncedRef.current;
    if (last && last.userId === userId && last.role === role) {
      // Nothing changed since the last successful sync.
      return;
    }
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    fetch("/api/auth/sync", { method: "GET", credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`auth sync ${res.status}: ${text.slice(0, 200)}`);
        }
        lastSyncedRef.current = { userId, role };
      })
      .catch((err) => {
        console.error("[AuthDrivenInvalidator] Failed to sync Clerk role to Convex:", err);
        // Do NOT mark lastSyncedRef — leave the role unsynced so a
        // subsequent effect run (e.g. after sign-in completes) retries.
      })
      .finally(() => {
        inFlightRef.current = false;
      });

    // Kick any convex-backed queries that mounted before auth was ready.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return first === "convexQuery" || first === "convexAction";
      },
    });
  }, [
    convexAuthLoading,
    isAuthenticated,
    clerkLoaded,
    userId,
    queryClient,
    sessionClaims,
  ]);

  return null;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // `useConvex()` returns `undefined` when no `ConvexProvider` is
  // above us. Used as a safe probe so we don't crash on the
  // build-time `skipClerk` branch where `<ConvexClientProvider>`
  // returns a bare fragment.
  const convex = useConvex();

  const [queryClient] = useState(
    () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            queryKeyHashFn: convexQueryClient?.hashFn(),
            queryFn: convexQueryClient?.queryFn(),
            staleTime: 1000 * 60,
            // @convex-dev/react-query can throw during query removal if its
            // subscription bookkeeping has already been cleaned up. Keep
            // entries alive across normal tab/workspace switches, but still
            // eventually GC.
            gcTime: 1000 * 60 * 60,
            retry: 3,
            refetchOnWindowFocus: true,
            refetchOnMount: true,
          },
          mutations: {
            retry: 1,
          },
        },
      });

      // Convex subscriptions already push live updates, so React Query does not
      // need to re-subscribe and re-fetch the current snapshot on every tab
      // focus or mount. Scope these defaults to Convex-backed queries only so
      // REST-backed queries keep the 1-minute staleTime and refetch on
      // focus/mount as before.
      client.setQueryDefaults(["convexQuery"], {
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      });
      client.setQueryDefaults(["convexAction"], {
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      });

      return client;
    }
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
