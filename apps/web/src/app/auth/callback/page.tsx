'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const setTokens = useAuth((s) => s.setTokens);
  const fetchMe = useAuth((s) => s.fetchMe);

  useEffect(() => {
    const access = params.get('access');
    const refresh = params.get('refresh');
    if (access && refresh) {
      setTokens(access, refresh);
      fetchMe().then(() => router.replace('/dashboard'));
    } else {
      router.replace('/login');
    }
  }, [params, router, setTokens, fetchMe]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse-glow rounded-2xl bg-brand-gradient px-6 py-4 font-display font-bold">Signing you in…</div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
