'use client';

import { useEffect } from 'react';
import { SWRConfig } from 'swr';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  const loadFromStorage = useAuth((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();
    // Register the PWA service worker.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, [loadFromStorage]);

  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        refreshInterval: 15_000,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
