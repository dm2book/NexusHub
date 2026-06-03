'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Compass, RefreshCw, Star } from 'lucide-react';
import { Card, ScoreBadge, SectionTitle, Skeleton, Pill } from '@/components/ui';
import { TokenAvatar } from '@/components/TokenAvatar';
import { price, pct, compact, up } from '@/lib/format';
import { api } from '@/lib/api';
import { useRealtime } from '@/lib/useRealtime';

interface Scored {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  holders: number;
  imageUrl?: string;
  scores: { momentum: number; opportunity: number; risk: number; confidence: number };
  risk: { score: number; level: string };
  reason: string;
}

export default function DiscoveryPage() {
  const { data, mutate, isLoading } = useSWR<Scored[]>('/discovery?limit=40');
  const [sort, setSort] = useState<'opportunity' | 'momentum' | 'risk'>('opportunity');
  useRealtime({ discovery: () => mutate() });

  const sorted = [...(data ?? [])].sort((a, b) =>
    sort === 'risk' ? a.scores.risk - b.scores.risk : b.scores[sort] - a.scores[sort],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Compass className="h-7 w-7 text-brand-300" /> Discovery</h1>
          <p className="text-sm text-slate-400">New launches, trending tokens & volume explosions — scored in realtime.</p>
        </div>
        <div className="flex items-center gap-2">
          {(['opportunity', 'momentum', 'risk'] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`pill ${sort === s ? 'bg-brand/20 text-brand-300' : 'bg-white/5 text-slate-400'}`}>
              {s}
            </button>
          ))}
          <button className="btn-ghost" onClick={() => mutate()}><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((t, i) => (
            <Card key={t.address} hover delay={i * 0.03} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <TokenAvatar symbol={t.symbol} src={t.imageUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold">{t.symbol}</span>
                    <Pill kind={t.priceChange24h >= 0 ? 'up' : 'down'}>{pct(t.priceChange24h)}</Pill>
                  </div>
                  <div className="truncate text-xs text-slate-500">{t.name}</div>
                </div>
                <button className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-accent-gold" title="Add to watchlist"
                  onClick={() => api.post('/watchlist', { tokenAddress: t.address, section: 'FAVORITES' })}>
                  <Star className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <ScoreBadge label="Mom" value={t.scores.momentum} kind={t.scores.momentum >= 60 ? 'good' : 'neutral'} />
                <ScoreBadge label="Opp" value={t.scores.opportunity} kind={t.scores.opportunity >= 60 ? 'good' : 'neutral'} />
                <ScoreBadge label="Risk" value={t.scores.risk} kind={t.scores.risk >= 60 ? 'bad' : 'neutral'} />
                <ScoreBadge label="Conf" value={t.scores.confidence} kind={t.scores.confidence >= 60 ? 'good' : 'neutral'} />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 tabular">
                <span>{price(t.priceUsd)}</span>
                <span>Vol ${compact(t.volume24h)}</span>
                <span>Liq ${compact(t.liquidityUsd)}</span>
                <span>{compact(t.holders)} hold</span>
              </div>
              <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-400">{t.reason}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
