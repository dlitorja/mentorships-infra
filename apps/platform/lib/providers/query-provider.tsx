"use client";

import { ConvexReactClient, useConvex } from "convex/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useConvexAuth } from "convex/react";
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
 * PR-D (Issue 1): synchronise the authenticated Clerk user's row
 * into the Convex `users` table as soon as Convex auth resolves.
 *
 * Synchronisation matters because instructor-dashboard queries
 * (e.g. `getInstructorStudentsWithRemainingSessions`) join
 * `seatReservations.userId` against `users.userId` for the
 * first/last/email columns that show up as the row headline.
 * Without a row in `users`, the headline collapses to the raw
 * Clerk id (e.g. `user_abc123def`) — instructors reported this
 * in production feedback as a UX cliff.
 *
 * The /api/auth/sync route reads Clerk user data server-side,
 * invokes the public `api.users.syncUser` mutation with a freshly
 * minted Convex JWT, and Convex upserts the `users` row keyed by
 * `clerkId` (see `isOwnedByIdentity` in `convex/users.ts` for the
 * resolved-account semantics; migration / placeholder rows get
 * patched on the first authenticated call). This component just
 * kicks that POST once per signed-in session.
 *
 * NOTE: unlike the marketing provider, this component deliberately
 * reads only `useConvexAuth()` and does NOT import `useClerkAuth`
 * from `@clerk/nextjs`. The `apps/platform/AGENTS.md` Clerk Changes
 * Policy restricts touching Clerk configuration / React code;
 * marketing's role-based dedup requires reading `sessionClaims`,
 * which is unnecessary here — `syncUser` is idempotent, so an
 * extra POST on each false→true auth transition is harmless.
 * Same outcome without the Clerk hook import.
 */

/**
 * Once Clerk populates the auth token:
 *   1. POST /api/auth/sync so a Clerk user with seats but no
 *      `users` row gets one written before the dashboard query
 *      subscribes (otherwise the headline is a raw Clerk id).
 *   2. Re-run any convex-backed queries. The library's auth-token
 *      change only refreshes subscriptions that were already
 *      wired; queries mounted while `isAuthenticated` was false
 *      need an explicit kick.
 *
 * Lives in its own component so `useConvexAuth()` is only called
 * when a `ConvexProvider` (typically `ConvexProviderWithClerk`)
 * is installed above us. In the `skipClerk` build-time branch
 * `<ConvexClientProvider>` returns a bare fragment, so
 * `useConvex()` is `undefined` and we skip mounting this child.
 */
function AuthDrivenInvalidator({ queryClient }: { queryClient: QueryClient }) {
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();

  // Track whether we've already kicked the sync for the current
  // signed-in session. `useConvexAuth()` flips `isAuthenticated`
  // when the JWT rotates between users (sign-in, sign-out +
  // different-user sign-in), so resetting the flag on auth-off
  // ensures a fresh sign-in always re-syncs.
  const lastSyncedRef = useRef(false);

  useEffect(() => {
    if (convexAuthLoading) return;
    if (!isAuthenticated) {
      // Reset on sign-out so a fresh sign-in (same user OR a
      // different account in the same browser) triggers a POST.
      lastSyncedRef.current = false;
      return;
    }
    if (lastSyncedRef.current) return;
    lastSyncedRef.current = true;

    // Kick any convex-backed queries that mounted before auth was ready.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return first === "convexQuery" || first === "convexAction";
      },
    });

    // Fire-and-forget POST. `syncUser` is idempotent; the route
    // is best-effort — a transient failure will leave the row
    // unsynced for this page view but the next mount / page-load
    // that flips `isAuthenticated` will retry (we reset on
    // sign-out, and a hard reload gives us a fresh ref with
    // `lastSyncedRef.current === false`).
    fetch("/api/auth/sync", { method: "GET", credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(
            `[AuthDrivenInvalidator] auth sync failed: ${res.status} ${text.slice(0, 200)}`,
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[AuthDrivenInvalidator] auth sync threw:", err);
      });
  }, [convexAuthLoading, isAuthenticated, queryClient]);

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
