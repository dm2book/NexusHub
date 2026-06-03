'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { TrendingUp, Wallet, Lock, Layers } from 'lucide-react';
import { Card, Stat, Pill, SectionTitle, Skeleton, Empty } from '@/components/ui';
import { TokenAvatar } from '@/components/TokenAvatar';
import { useRealtime } from '@/lib/useRealtime';
import { usd, price, pct, up, duration } from '@/lib/format';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Summary {
  totalValueUsd: number;
  reserveUsd: number;
  openPositions: number;
  closedPositions: number;
  pnl: {
    dailyUsd: number; weeklyUsd: number; monthlyUsd: number; totalUsd: number;
    dailyPct: number; weeklyPct: number; monthlyPct: number; totalPct: number;
  };
}

interface Position {
  id: string;
  token: { symbol: string; name: string; address: string; priceUsd: number; imageUrl?: string };
  entryPriceUsd: number;
  currentPriceUsd: number;
  sizeUsd: number;
  profitPct: number;
  profitUsd: number;
  timeHeldMs: number;
}

export default function DashboardPage() {
  const role = useAuth((s) => s.user?.role);
  const { data: summary, mutate: mutateSummary } = useSWR<Summary>('/portfolio/summary');
  const { data: positions, mutate: mutatePositions } = useSWR<Position[]>('/portfolio/positions?status=OPEN');

  useRealtime({
    portfolio: () => {
      mutateSummary();
      mutatePositions();
    },
    prices: () => mutatePositions(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Portfolio</h1>
          <p className="text-sm text-slate-400">Realtime overview of your positions and performance.</p>
        </div>
        {role === 'OWNER' && <OpenPositionButton onDone={() => { mutateSummary(); mutatePositions(); }} />}
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summary ? (
          <>
            <Card delay={0}><Stat label="Portfolio Value" value={usd(summary.totalValueUsd)} sub={<><Wallet className="mr-1 inline h-3 w-3" />{summary.openPositions} open</>} /></Card>
            <Card delay={0.05}><Stat label="Total PnL" value={usd(summary.pnl.totalUsd)} accent={summary.pnl.totalUsd >= 0 ? 'up' : 'down'} sub={pct(summary.pnl.totalPct)} /></Card>
            <Card delay={0.1}><Stat label="Daily PnL" value={usd(summary.pnl.dailyUsd)} accent={summary.pnl.dailyUsd >= 0 ? 'up' : 'down'} sub={pct(summary.pnl.dailyPct)} /></Card>
            <Card delay={0.15}><Stat label="Reserve (locked)" value={usd(summary.reserveUsd)} accent="brand" sub={<><Lock className="mr-1 inline h-3 w-3" />manual withdrawal</>} /></Card>
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        )}
      </div>

      {/* PnL windows */}
      {summary && (
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {([['Daily', summary.pnl.dailyUsd, summary.pnl.dailyPct], ['Weekly', summary.pnl.weeklyUsd, summary.pnl.weeklyPct], ['Monthly', summary.pnl.monthlyUsd, summary.pnl.monthlyPct], ['Total', summary.pnl.totalUsd, summary.pnl.totalPct]] as const).map(([label, v, p]) => (
              <div key={label}>
                <div className="stat-label">{label}</div>
                <div className={`mt-1 font-display text-lg font-bold tabular ${up(v)}`}>{usd(v)}</div>
                <div className={`text-xs tabular ${up(p)}`}>{pct(p)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Positions */}
      <div>
        <SectionTitle title="Open Positions" action={<Pill kind="neutral"><Layers className="h-3 w-3" />{positions?.length ?? 0}</Pill>} />
        {!positions ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : positions.length === 0 ? (
          <Empty title="No open positions" hint={role === 'OWNER' ? 'Track a token to get started.' : 'The owner has no open positions.'} />
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="divide-y divide-white/5">
              {positions.map((p, i) => (
                <motion.a
                  key={p.id}
                  href={`/intelligence?token=${p.token.address}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/[0.03]"
                >
                  <TokenAvatar symbol={p.token.symbol} src={p.token.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold">{p.token.symbol}</span>
                      <span className="truncate text-xs text-slate-500">{p.token.name}</span>
                    </div>
                    <div className="text-xs text-slate-500 tabular">
                      Entry {price(p.entryPriceUsd)} → {price(p.currentPriceUsd)} · held {duration(p.timeHeldMs)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-display font-bold tabular ${up(p.profitPct)}`}>{pct(p.profitPct)}</div>
                    <div className={`text-xs tabular ${up(p.profitUsd)}`}>{usd(p.profitUsd)}</div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="stat-label">Size</div>
                    <div className="text-sm tabular text-slate-300">{usd(p.sizeUsd)}</div>
                  </div>
                </motion.a>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function OpenPositionButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [tokenAddress, setAddr] = useState('');
  const [sizeUsd, setSize] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      const pos = await api.post<{ id: string }>('/portfolio/positions', { tokenAddress, sizeUsd: Number(sizeUsd) });
      await api.post(`/automation/positions/${pos.id}/rules/default-ladder`).catch(() => undefined);
      setOpen(false);
      setAddr('');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <TrendingUp className="h-4 w-4" /> Track position
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="glass w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">Track a position</h3>
            <p className="mt-1 text-xs text-slate-500">Records a tracked holding with the default auto-sell ladder. This is not an automated buy.</p>
            <div className="mt-4 space-y-3">
              <input className="input" placeholder="Token address" value={tokenAddress} onChange={(e) => setAddr(e.target.value)} />
              <input className="input" placeholder="Size (USD)" type="number" value={sizeUsd} onChange={(e) => setSize(e.target.value)} />
              {err && <div className="text-sm text-down">{err}</div>}
              <button className="btn-primary w-full" disabled={busy || !tokenAddress} onClick={submit}>
                {busy ? 'Tracking…' : 'Track position'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
