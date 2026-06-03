'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { BookOpen, Plus } from 'lucide-react';
import { Card, Stat, SectionTitle, Skeleton, Pill, Empty } from '@/components/ui';
import { usd, pct, up, timeAgo } from '@/lib/format';
import { api } from '@/lib/api';

interface Entry {
  id: string;
  tokenSymbol: string;
  entryReason?: string;
  exitReason?: string;
  lesson?: string;
  pnlUsd?: number;
  pnlPct?: number;
  createdAt: string;
}

interface Performance {
  totalEntries: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  avgPnlPct: number;
}

export default function JournalPage() {
  const { data: entries, mutate } = useSWR<Entry[]>('/journal');
  const { data: perf } = useSWR<Performance>('/journal/performance');
  const [form, setForm] = useState({ tokenSymbol: '', entryReason: '', exitReason: '', lesson: '', pnlUsd: '', pnlPct: '' });
  const [open, setOpen] = useState(false);

  async function submit() {
    await api.post('/journal', {
      tokenSymbol: form.tokenSymbol,
      entryReason: form.entryReason || undefined,
      exitReason: form.exitReason || undefined,
      lesson: form.lesson || undefined,
      pnlUsd: form.pnlUsd ? Number(form.pnlUsd) : undefined,
      pnlPct: form.pnlPct ? Number(form.pnlPct) : undefined,
    });
    setForm({ tokenSymbol: '', entryReason: '', exitReason: '', lesson: '', pnlUsd: '', pnlPct: '' });
    setOpen(false);
    mutate();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><BookOpen className="h-7 w-7 text-brand-300" /> Trading Journal</h1>
          <p className="text-sm text-slate-400">Log entry/exit reasons & lessons. Build a performance record.</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen((o) => !o)}><Plus className="h-4 w-4" /> New entry</button>
      </div>

      {perf && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card><Stat label="Win rate" value={`${perf.winRate.toFixed(0)}%`} accent="brand" sub={`${perf.wins}W / ${perf.losses}L`} /></Card>
          <Card><Stat label="Total PnL" value={usd(perf.totalPnlUsd)} accent={perf.totalPnlUsd >= 0 ? 'up' : 'down'} /></Card>
          <Card><Stat label="Avg return" value={pct(perf.avgPnlPct)} accent={perf.avgPnlPct >= 0 ? 'up' : 'down'} /></Card>
          <Card><Stat label="Entries" value={perf.totalEntries} /></Card>
        </div>
      )}

      {open && (
        <Card>
          <SectionTitle title="New journal entry" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" placeholder="Token symbol" value={form.tokenSymbol} onChange={(e) => setForm({ ...form, tokenSymbol: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <input className="input" placeholder="PnL $" type="number" value={form.pnlUsd} onChange={(e) => setForm({ ...form, pnlUsd: e.target.value })} />
              <input className="input" placeholder="PnL %" type="number" value={form.pnlPct} onChange={(e) => setForm({ ...form, pnlPct: e.target.value })} />
            </div>
            <textarea className="input sm:col-span-2" rows={2} placeholder="Entry reason" value={form.entryReason} onChange={(e) => setForm({ ...form, entryReason: e.target.value })} />
            <textarea className="input sm:col-span-2" rows={2} placeholder="Exit reason" value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} />
            <textarea className="input sm:col-span-2" rows={2} placeholder="Lesson learned" value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} />
          </div>
          <button className="btn-primary mt-3" onClick={submit} disabled={!form.tokenSymbol}>Save entry</button>
        </Card>
      )}

      {!entries ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : entries.length === 0 ? (
        <Empty title="No journal entries yet" hint="Log your first trade reasoning." />
      ) : (
        <div className="space-y-3">
          {entries.map((e, i) => (
            <Card key={e.id} delay={i * 0.03}>
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold">{e.tokenSymbol}</span>
                <div className="flex items-center gap-2">
                  {e.pnlPct != null && <Pill kind={e.pnlPct >= 0 ? 'up' : 'down'}>{pct(e.pnlPct)}</Pill>}
                  {e.pnlUsd != null && <span className={`text-sm font-bold tabular ${up(e.pnlUsd)}`}>{usd(e.pnlUsd)}</span>}
                  <span className="text-xs text-slate-500">{timeAgo(e.createdAt)} ago</span>
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-sm text-slate-400 sm:grid-cols-3">
                {e.entryReason && <div><span className="text-brand-300">Entry:</span> {e.entryReason}</div>}
                {e.exitReason && <div><span className="text-brand-300">Exit:</span> {e.exitReason}</div>}
                {e.lesson && <div><span className="text-accent-gold">Lesson:</span> {e.lesson}</div>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
