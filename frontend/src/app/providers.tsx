"use client";

import { ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { UserProvider } from "@/lib/context/UserContext";
import { AppearanceProvider } from "@/components/AppearanceProvider";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  // Create QueryClient with production-grade optimizations
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // CRITICAL: Stale data is better than no data
            staleTime: 60 * 1000, // 1 minute (data stays fresh)
            gcTime: 5 * 60 * 1000, // 5 minutes (cache retention)
            
            // Performance optimizations
            refetchOnWindowFocus: false, // Don't refetch on tab switch
            refetchOnReconnect: true, // DO refetch when internet returns
            retry: 1, // Only retry once (fail fast)
            
            // INSTANT perception - show old data while fetching new
            placeholderData: (previousData: unknown) => previousData,
          },
          mutations: {
            // Fast fail for mutations
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <UserProvider>
          {children}
        </UserProvider>
      </AppearanceProvider>
      {/* DevTools only in development */}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
