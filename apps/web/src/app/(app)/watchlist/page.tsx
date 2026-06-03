'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Star, Plus, Trash2 } from 'lucide-react';
import { Card, ScoreBadge, Skeleton, Pill, Empty } from '@/components/ui';
import { TokenAvatar } from '@/components/TokenAvatar';
import { price, pct } from '@/lib/format';
import { api } from '@/lib/api';

const SECTIONS = ['FAVORITES', 'TRENDING', 'NEW_LAUNCHES', 'VOLUME_MOVERS', 'WHALE_ACTIVITY', 'SMART_MONEY'] as const;
const LABELS: Record<string, string> = {
  FAVORITES: '⭐ Favorites', TRENDING: '🔥 Trending', NEW_LAUNCHES: '🆕 New Launches',
  VOLUME_MOVERS: '📊 Volume Movers', WHALE_ACTIVITY: '🐋 Whale Activity', SMART_MONEY: '🧠 Smart Money',
};

interface Item {
  id: string;
  symbol: string;
  name: string;
  address: string;
  priceUsd: number;
  priceChange24h: number;
  scores: { opportunity: number; risk: number };
}

export default function WatchlistPage() {
  const { data, mutate, isLoading } = useSWR<Record<string, Item[]>>('/watchlist');
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('FAVORITES');
  const [addr, setAddr] = useState('');

  async function add() {
    if (!addr) return;
    await api.post('/watchlist', { tokenAddress: addr, section });
    setAddr('');
    mutate();
  }
  async function remove(id: string) {
    await api.del(`/watchlist/${id}`);
    mutate();
  }

  const items = data?.[section] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Star className="h-7 w-7 text-accent-gold" /> Watchlist</h1>
        <p className="text-sm text-slate-400">Organize tokens by section and watch their scores update live.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => setSection(s)} className={`pill ${section === s ? 'bg-brand/20 text-brand-300' : 'bg-white/5 text-slate-400'}`}>
            {LABELS[s]} {data?.[s]?.length ? <span className="opacity-60">{data[s].length}</span> : null}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex gap-2">
          <input className="input" placeholder={`Add token to ${LABELS[section]}`} value={addr} onChange={(e) => setAddr(e.target.value)} />
          <button className="btn-primary" onClick={add}><Plus className="h-4 w-4" /> Add</button>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : items.length === 0 ? (
        <Empty title={`${LABELS[section]} is empty`} hint="Add a token address above." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="divide-y divide-white/5">
            {items.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <TokenAvatar symbol={t.symbol} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-display font-bold">{t.symbol}</span><Pill kind={t.priceChange24h >= 0 ? 'up' : 'down'}>{pct(t.priceChange24h)}</Pill></div>
                  <div className="truncate text-xs text-slate-500">{t.name} · {price(t.priceUsd)}</div>
                </div>
                <ScoreBadge label="Opp" value={t.scores.opportunity} kind={t.scores.opportunity >= 60 ? 'good' : 'neutral'} />
                <ScoreBadge label="Risk" value={t.scores.risk} kind={t.scores.risk >= 60 ? 'bad' : 'neutral'} />
                <button className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-down" onClick={() => remove(t.id)}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
