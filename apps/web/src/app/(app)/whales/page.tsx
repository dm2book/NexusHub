'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Fish, Brain } from 'lucide-react';
import { Card, SectionTitle, Skeleton, Pill, Empty } from '@/components/ui';
import { TokenAvatar } from '@/components/TokenAvatar';
import { usd, pct, timeAgo, up } from '@/lib/format';
import { useRealtime } from '@/lib/useRealtime';

interface WhaleTx {
  id: string;
  side: 'BUY' | 'SELL';
  amountUsd: number;
  timestamp: string;
  walletLabel?: string;
  token: { symbol: string; address: string; imageUrl?: string };
}

interface SmartWallet {
  id: string;
  address: string;
  label?: string;
  roiPct: number;
  winRate: number;
  totalPnlUsd: number;
  recentTrades: Array<{ side: string; amountUsd: number; token: { symbol: string } }>;
}

export default function WhalesPage() {
  const [tab, setTab] = useState<'whales' | 'smart'>('whales');
  const { data: whales, mutate } = useSWR<WhaleTx[]>('/whales?limit=60');
  const { data: smart } = useSWR<SmartWallet[]>('/smart-money');
  useRealtime({ whales: () => mutate() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold flex items-center gap-2"><Fish className="h-7 w-7 text-brand-300" /> Whales & Smart Money</h1>
        <p className="text-sm text-slate-400">Track large wallets and high-performing smart money in realtime.</p>
      </div>

      <div className="flex gap-2">
        {(['whales', 'smart'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`}>
            {t === 'whales' ? '🐋 Whale Activity' : '🧠 Smart Money'}
          </button>
        ))}
      </div>

      {tab === 'whales' ? (
        !whales ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : whales.length === 0 ? (
          <Empty title="No whale activity yet" hint="Whale transfers will appear here as they happen." />
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="divide-y divide-white/5">
              {whales.map((w) => (
                <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full ${w.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>🐋</span>
                  <TokenAvatar symbol={w.token.symbol} src={w.token.imageUrl} size={28} />
                  <div className="flex-1">
                    <div className="font-display font-semibold">
                      {w.token.symbol} <Pill kind={w.side === 'BUY' ? 'up' : 'down'}>{w.side}</Pill>
                    </div>
                    <div className="text-xs text-slate-500">{w.walletLabel ?? 'Whale'} · {timeAgo(w.timestamp)} ago</div>
                  </div>
                  <div className={`font-display font-bold tabular ${w.side === 'BUY' ? 'text-up' : 'text-down'}`}>{usd(w.amountUsd)}</div>
                </div>
              ))}
            </div>
          </Card>
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(smart ?? []).map((s, i) => (
            <Card key={s.id} hover delay={i * 0.03}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-brand-300" />
                  <span className="font-display font-bold">{s.label ?? `${s.address.slice(0, 6)}…`}</span>
                </div>
                <Pill kind="up">ROI {pct(s.roiPct)}</Pill>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div><div className="stat-label">Win rate</div><div className="font-bold tabular">{s.winRate.toFixed(0)}%</div></div>
                <div><div className="stat-label">PnL</div><div className={`font-bold tabular ${up(s.totalPnlUsd)}`}>{usd(s.totalPnlUsd)}</div></div>
                <div><div className="stat-label">Trades</div><div className="font-bold tabular">{s.recentTrades.length}</div></div>
              </div>
              {s.recentTrades.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {s.recentTrades.map((t, j) => (
                    <span key={j} className="pill bg-white/5 text-slate-300">{t.side === 'BUY' ? '🟢' : '🔴'} {t.token.symbol}</span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
