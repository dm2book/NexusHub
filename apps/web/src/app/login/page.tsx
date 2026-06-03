'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, Mail, ArrowRight } from 'lucide-react';
import { API_URL, API_BASE_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const setTokens = useAuth((s) => s.setTokens);
  const fetchMe = useAuth((s) => s.fetchMe);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Failed');
      setDevCode(json.data?.devCode ?? null);
      setStage('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Invalid code');
      setTokens(json.data.accessToken, json.data.refreshToken);
      await fetchMe();
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass w-full max-w-md p-8"
      >
        <div className="mb-8 flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-brand-300" />
          <span className="font-display text-2xl font-extrabold">
            Meme<span className="text-brand-300">Forge</span>
          </span>
        </div>
        <h1 className="font-display text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-400">Sign in to your private trading terminal.</p>

        {stage === 'email' ? (
          <form onSubmit={requestOtp} className="mt-6 space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input pl-10"
              />
            </div>
            <button disabled={busy} className="btn-primary w-full">
              {busy ? 'Sending…' : 'Continue with email'} <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="mt-6 space-y-4">
            <p className="text-sm text-slate-400">
              Enter the 6-digit code sent to <span className="text-slate-200">{email}</span>.
            </p>
            {devCode && (
              <div className="rounded-xl border border-brand/20 bg-brand/10 px-3 py-2 text-sm text-brand-300">
                Dev code: <span className="font-mono font-bold">{devCode}</span>
              </div>
            )}
            <input
              inputMode="numeric"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className="input text-center font-mono text-2xl tracking-[0.5em]"
            />
            <button disabled={busy} className="btn-primary w-full">
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button type="button" onClick={() => setStage('email')} className="w-full text-center text-xs text-slate-500 hover:text-slate-300">
              Use a different email
            </button>
          </form>
        )}

        {error && <div className="mt-4 rounded-xl border border-down/20 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}

        <div className="my-6 flex items-center gap-3 text-xs text-slate-600">
          <div className="h-px flex-1 bg-white/10" /> OR <div className="h-px flex-1 bg-white/10" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <a href={`${API_BASE_URL}/api/v1/auth/google`} className="btn-ghost">Google</a>
          <a href={`${API_BASE_URL}/api/v1/auth/discord`} className="btn-ghost">Discord</a>
        </div>
      </motion.div>
    </div>
  );
}
