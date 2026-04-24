"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useRef, useState } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

let convexQueryClient: ConvexQueryClient | null = null;
let convexClient: ConvexReactClient | null = null;

if (convexUrl) {
  convexClient = new ConvexReactClient(convexUrl);
  convexQueryClient = new ConvexQueryClient(convexClient);
}

export { convexClient, convexQueryClient };

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
