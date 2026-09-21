import { useEffect, useState } from 'react';
import { Coins, Ticket, Sparkles, Copy, Check, History } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const REASON = { order: 'Earned from an order', redeem: 'Redeemed in Forge Shop' };

export default function ForgeShop() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');

  const load = () => api.get('/api/account/coins').then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, []);

  const redeem = async (r) => {
    if (data.balance < r.cost) { toast.error('Not enough Forge Coins yet.'); return; }
    setBusy(r.id);
    try {
      const res = await api.post('/api/account/coins/redeem', { rewardId: r.id });
      if (res.couponCode) toast.success(`Unlocked! Your code: ${res.couponCode}`);
      else toast.success('Redeemed! Claim it in our Discord.');
      await load();
    } catch (e) { toast.error(e.message || 'Could not redeem.'); }
    finally { setBusy(''); }
  };

  const copy = (code) => { navigator.clipboard?.writeText(code); setCopied(code); toast.success('Code copied'); setTimeout(() => setCopied(''), 1500); };

  if (data === null) return <PageLoader />;
  if (!data) return <div className="card p-8 text-slate-400">Couldn’t load the Forge Shop.</div>;

  const ICON = { coupon: Ticket, boost: Sparkles };

  /* The cheapest thing still out of reach — so the header can say what the
     balance is FOR, not only what it is. Undefined once everything is
     affordable, and the line disappears rather than congratulating anyone. */
  const next = (data?.shop || [])
    .filter((r) => r.cost > (data?.balance ?? 0))
    .sort((a, b) => a.cost - b.cost)[0];

  return (
    <div className="space-y-6">
      {/* Balance header.
          It was an orange-to-pink gradient, which is the loudest thing on the
          page and belongs to no other surface in this product — the logo, the
          active nav item and every primary button are indigo/violet. The gold
          stays on the COINS, where it means something, and the panel joins the
          rest of the shop. */}
      <div className="rounded-2xl p-6 text-white relative overflow-hidden
        border border-white/10 bg-elevated/60 shadow-lg shadow-primary/10">
        <div className="orb w-72 h-72 bg-primary/20 -top-24 -right-16 pointer-events-none" />
        <div className="relative flex flex-wrap items-center gap-5">
          <span className="w-14 h-14 rounded-2xl grid place-items-center text-amber-300
            bg-amber-400/10 ring-1 ring-amber-400/25">
            <Coins size={28} />
          </span>
          <div>
            <div className="text-sm text-slate-400">Your Forge Coins</div>
            <div className="text-4xl font-extrabold leading-none text-amber-300 tabular-nums">
              {data.balance}
            </div>
          </div>
          {/* What the balance is worth right now, instead of only what it is. */}
          {next && (
            <div className="sm:ml-auto text-sm text-slate-400">
              {next.cost - data.balance} more for <span className="text-slate-200">{next.label}</span>
            </div>
          )}
        </div>
        <p className="relative text-slate-400 text-sm mt-4 max-w-2xl">
          Earn <b className="text-slate-200">1 coin for every €10</b> you spend — automatically.
          Spend them below on discount codes and giveaway boosts.
        </p>
      </div>

      {/* Shop */}
      <div>
        <h2 className="text-lg text-white font-bold mb-3">Forge Shop</h2>
        {/* Four across on a wide screen. The page was capped at max-w-3xl, so on
            a 1400px window the content sat in 770px and the right half of the
            screen was empty. */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {data.shop.map((r) => {
            const Icon = ICON[r.kind] || Ticket;
            const afford = data.balance >= r.cost;
            return (
              <div key={r.id} className="card p-5 flex flex-col">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 grid place-items-center"><Icon size={18} /></span>
                  <div className="font-semibold text-white">{r.label}</div>
                </div>
                <p className="text-slate-400 text-sm flex-1">{r.blurb}</p>
                {/* How close you are, not just that you are not there.
                    "Need 15 more" on a dead grey button says the door is shut;
                    the bar says how far along you already are, from numbers the
                    page is holding anyway. */}
                {!afford && (
                  <div className="mt-4" aria-hidden="true">
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300
                        transition-[width] duration-500"
                        style={{ width: `${Math.min(100, Math.round((data.balance / r.cost) * 100))}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 mt-4">
                  <span className="inline-flex items-center gap-1.5 text-amber-300 font-bold tabular-nums">
                    <Coins size={15} /> {r.cost}
                  </span>
                  <button onClick={() => redeem(r)} disabled={!afford || busy === r.id}
                    className={`text-sm font-semibold rounded-xl px-4 py-2 transition whitespace-nowrap
                      ${afford ? 'btn-primary' : 'bg-white/5 text-slate-500 cursor-not-allowed'}`}>
                    {busy === r.id ? '…' : afford ? 'Redeem' : `${r.cost - data.balance} to go`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="card p-5">
        <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><History size={16} className="text-slate-400" /> History</h3>
        {(!data.history || data.history.length === 0) ? (
          <p className="text-slate-500 text-sm">No coins yet — place an order to start earning.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {data.history.map((h, i) => {
              const code = h.reason === 'redeem' && /^FORGE[A-Z0-9]+$/.test(h.ref || '') ? h.ref : null;
              return (
                <div key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="text-slate-200">{REASON[h.reason] || h.reason}</div>
                    <div className="text-slate-500 text-xs">{date(h.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {code && (
                      <button onClick={() => copy(code)}
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1 hover:bg-amber-500/20 transition">
                        {code} {copied === code ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                    <span className={`font-bold ${h.delta > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-slate-500 text-xs">Redeemed a discount code? It stays in your <b className="text-slate-400">History</b> above — copy it any time and use it at checkout. Codes are single-use.</p>
    </div>
  );
}
