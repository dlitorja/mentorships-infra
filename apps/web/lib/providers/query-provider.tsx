"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

/**
 * QueryClient provider for TanStack Query
 * 
 * Creates a QueryClient instance with sensible defaults:
 * - Stale time: 1 minute (data considered fresh for 1 minute)
 * - Cache time: 5 minutes (data kept in cache for 5 minutes after last use)
 * - Retry: 3 times with exponential backoff
 * - Refetch on window focus: enabled (refetches stale data when window regains focus)
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 1 minute
            staleTime: 1000 * 60,
            // Data stays in cache for 5 minutes after last use
            gcTime: 1000 * 60 * 5,
            // Retry failed requests 3 times
            retry: 3,
            // Refetch stale data when window regains focus
            refetchOnWindowFocus: true,
            // Don't refetch on mount if data is fresh
            refetchOnMount: true,
          },
          mutations: {
            // Retry failed mutations once
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Only show devtools in development */}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

