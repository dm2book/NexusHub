'use client';

import { Suspense, useState } from 'react';
import useSWR from 'swr';
import { Brain, Sparkles, Search } from 'lucide-react';
import { Card, SectionTitle, Skeleton, Pill } from '@/components/ui';
import { pct } from '@/lib/format';
import { api } from '@/lib/api';

const REPORT_TYPES = ['DAILY', 'WEEKLY', 'MARKET', 'RISK', 'OPPORTUNITY'] as const;

interface Report {
  id: string;
  title: string;
  summary: string;
  payload: { sections: Array<{ heading: string; body: string; bullets?: string[] }> };
  createdAt: string;
}

export default function IntelligencePage() {
  const [type, setType] = useState<(typeof REPORT_TYPES)[number]>('DAILY');
  const { data: reports, mutate } = useSWR<Report[]>(`/ai/reports?type=${type}`);
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      await api.post('/ai/reports', { type });
      await mutate();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Brain className="h-7 w-7 text-brand-300" /> AI Market Brain</h1>
        <p className="text-sm text-slate-400">Continuous analysis of your portfolio, market, whales, smart money & risk.</p>
      </div>

      <Suspense><WhyMoveCard /></Suspense>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {REPORT_TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} className={`pill ${type === t ? 'bg-brand/20 text-brand-300' : 'bg-white/5 text-slate-400'}`}>{t}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={generate} disabled={generating}>
          <Sparkles className="h-4 w-4" /> {generating ? 'Generating…' : 'Generate report'}
        </button>
      </div>

      {!reports ? (
        <Skeleton className="h-48" />
      ) : reports.length === 0 ? (
        <Card><p className="text-sm text-slate-400">No {type.toLowerCase()} reports yet. Generate one above.</p></Card>
      ) : (
        <div className="space-y-4">
          {reports.map((r, i) => (
            <Card key={r.id} delay={i * 0.04}>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">{r.title}</h3>
                <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-sm text-slate-300">{r.summary}</p>
              <div className="mt-4 space-y-3">
                {r.payload.sections.map((s, j) => (
                  <div key={j} className="rounded-xl bg-white/[0.03] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-brand-300">{s.heading}</div>
                    {s.body && <p className="mt-1 text-sm text-slate-300">{s.body}</p>}
                    {s.bullets && (
                      <ul className="mt-1 space-y-0.5 text-sm text-slate-400">
                        {s.bullets.map((b, k) => <li key={k}>• {b}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WhyMoveCard() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<{ title: string; direction: string; changePct: number; reasons: string[]; token: { symbol: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function explain() {
    if (!address) return;
    setBusy(true);
    setErr('');
    try {
      setResult(await api.get(`/ai/explain/${address}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle title="Why am I up / down?" />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
          <input className="input pl-10" placeholder="Token address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={explain} disabled={busy}>{busy ? 'Analyzing…' : 'Explain'}</button>
      </div>
      {err && <p className="mt-2 text-sm text-down">{err}</p>}
      {result && (
        <div className="mt-4 rounded-xl bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-bold">{result.title}</span>
            <Pill kind={result.direction === 'up' ? 'up' : 'down'}>{pct(result.changePct)}</Pill>
          </div>
          <ul className="mt-3 space-y-1.5">
            {result.reasons.map((r, i) => <li key={i} className="text-sm text-slate-300">{r}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}
