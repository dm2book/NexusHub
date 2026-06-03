'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const { loading, accessToken } = useAuth();
  useEffect(() => {
    if (loading) return;
    router.replace(accessToken ? '/dashboard' : '/login');
  }, [loading, accessToken, router]);
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-pulse-glow rounded-2xl bg-brand-gradient px-6 py-4 font-display font-bold">MemeForge</div>
    </div>
  );
}
