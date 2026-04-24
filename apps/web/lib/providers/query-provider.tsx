"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useRef, useState } from "react";
import { convexQueryClient } from "@/lib/convex-client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const connected = useRef(false);

  const [queryClient] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          queryKeyHashFn: convexQueryClient?.hashFn(),
          queryFn: convexQueryClient?.queryFn(),
          staleTime: 1000 * 60,
          gcTime: 1000 * 60 * 5,
          retry: 3,
          refetchOnWindowFocus: true,
          refetchOnMount: true,
        },
        mutations: {
          retry: 1,
        },
      },
    });
    return qc;
  });

  useEffect(() => {
    if (convexQueryClient && !connected.current) {
      convexQueryClient.connect(queryClient);
      connected.current = true;
    }
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}