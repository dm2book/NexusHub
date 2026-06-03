'use client';

import useSWR from 'swr';
import { BarChart3 } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Stat, SectionTitle, Skeleton } from '@/components/ui';
import { usd, up } from '@/lib/format';

interface Analytics {
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  avgReturnUsd: number;
  avgWinUsd: number;
  avgLossUsd: number;
  reserveUsd: number;
  bestTrades: Array<{ symbol: string; pnlUsd: number } | null>;
  worstTrades: Array<{ symbol: string; pnlUsd: number } | null>;
  growthCurve: Array<{ t: string; pnl: number }>;
}

export default function AnalyticsPage() {
  const { data } = useSWR<Analytics>('/analytics');

  if (!data) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-72" /></div>;
  }

  const chartData = data.growthCurve.map((p, i) => ({ i, pnl: Number(p.pnl.toFixed(2)), label: new Date(p.t).toLocaleDateString() }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><BarChart3 className="h-7 w-7 text-brand-300" /> Analytics</h1>
        <p className="text-sm text-slate-400">Profit analytics, win rate and portfolio growth.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><Stat label="Win rate" value={`${data.winRate.toFixed(0)}%`} accent="brand" sub={`${data.wins}W / ${data.losses}L`} /></Card>
        <Card><Stat label="Realized PnL" value={usd(data.realizedPnlUsd)} accent={data.realizedPnlUsd >= 0 ? 'up' : 'down'} /></Card>
        <Card><Stat label="Unrealized PnL" value={usd(data.unrealizedPnlUsd)} accent={data.unrealizedPnlUsd >= 0 ? 'up' : 'down'} /></Card>
        <Card><Stat label="Avg return / trade" value={usd(data.avgReturnUsd)} accent={data.avgReturnUsd >= 0 ? 'up' : 'down'} /></Card>
      </div>

      <Card>
        <SectionTitle title="Portfolio growth (realized PnL)" />
        {chartData.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No realized trades yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" stroke="#475569" fontSize={11} tickLine={false} />
              <YAxis stroke="#475569" fontSize={11} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }} />
              <Area type="monotone" dataKey="pnl" stroke="#8b5cf6" strokeWidth={2} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle title="🏆 Best trades" />
          <div className="space-y-2">
            {data.bestTrades.filter(Boolean).map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="font-display font-semibold">{t!.symbol}</span>
                <span className="font-bold tabular text-up">{usd(t!.pnlUsd)}</span>
              </div>
            ))}
            {data.bestTrades.filter(Boolean).length === 0 && <p className="text-sm text-slate-500">No trades yet.</p>}
          </div>
        </Card>
        <Card>
          <SectionTitle title="💀 Worst trades" />
          <div className="space-y-2">
            {data.worstTrades.filter(Boolean).map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="font-display font-semibold">{t!.symbol}</span>
                <span className={`font-bold tabular ${up(t!.pnlUsd)}`}>{usd(t!.pnlUsd)}</span>
              </div>
            ))}
            {data.worstTrades.filter(Boolean).length === 0 && <p className="text-sm text-slate-500">No trades yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
