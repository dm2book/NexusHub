import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Ticket, Sparkles, Copy, Check, History } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
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

  /* Everything below is worked out by the SERVER now, in coinProgress(), and
     read here. It was computed in this component last round — which made it a
     second copy of the same arithmetic the moment /balance in Discord needed
     the same answer, and the bot could not reach a React component. One
     function, two surfaces, no drift. */
  const shop = data.shop || [];
  const balance = data.balance ?? 0;
  const next = data.next;
  const earned = data.totals?.earned ?? null;
  const spent = data.totals?.spent ?? null;
  const boosts = data.boosts ?? 0;
  const bestValueId = data.bestValueId ?? null;
  const perCoin = (data.perCoinCents ?? 1000) / 100;
  const spendToReach = (cost) => Math.max(0, cost - balance) * perCoin;

  return (
    <div className="space-y-6">
      {/* Balance header.
          It was an orange-to-pink gradient, which is the loudest thing on the
          page and belongs to no other surface in this product — the logo, the
          active nav item and every primary button are indigo/violet. The gold
          stays on the COINS, where it means something. */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10
        bg-gradient-to-br from-elevated/80 via-elevated/50 to-space-black/60 p-6 sm:p-8">
        <div className="orb w-80 h-80 bg-primary/20 -top-28 -right-20 pointer-events-none" />
        <div className="orb w-56 h-56 bg-amber-500/10 -bottom-24 left-1/3 pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-end gap-8">
          <div className="min-w-0">
            <div className="text-[13px] uppercase tracking-widest text-slate-500 font-semibold">
              Your Forge Coins
            </div>
            <div className="flex items-end gap-3 mt-1">
              <Coins size={34} className="text-amber-300 mb-1.5 shrink-0" />
              <span className="text-6xl sm:text-7xl font-extrabold leading-none tabular-nums
                bg-gradient-to-b from-amber-200 to-amber-400 bg-clip-text text-transparent">
                {balance}
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-3 max-w-md">
              Every <b className="text-slate-200">{money(data.perCoinCents ?? 1000)}</b> you spend
              earns a coin, automatically. Spend them below.
            </p>
          </div>

          {/* Facts, not decoration: two lifetime sums and the next thing the
              balance is working toward. */}
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 lg:ml-auto">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500">Earned</dt>
              <dd className="text-slate-200 font-semibold tabular-nums">
                {earned == null ? '—' : earned}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-500">Spent</dt>
              <dd className="text-slate-200 font-semibold tabular-nums">
                {spent == null ? '—' : spent}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-[11px] uppercase tracking-wider text-slate-500">Next reward</dt>
              <dd className="text-slate-200 font-semibold">
                {/* The label in full. Trimming " discount code" off it turned
                    "€10 discount code" into "€10", so the line read "9 more for
                    €10" — which sounds like a price, not a reward. */}
                {next
                  ? <>{next.coinsAway}
                      <span className="text-slate-500 font-normal"> → {next.label}</span></>
                  : <span className="text-emerald-300">everything unlocked</span>}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* A boost you have paid for and not yet used.
          It had nowhere on this page at all: you spent eight coins, the toast
          said "claim it in our Discord", and there was nothing in Discord to
          claim — the draw kept entrants in a Set, so an extra entry could not
          be represented. It is a held thing now, and it says what happens to
          it, because "claim it somewhere" was the part that was not true. */}
      {boosts > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-fuchsia-400/25
          bg-fuchsia-500/[0.07] px-5 py-4">
          <span className="w-10 h-10 rounded-xl bg-fuchsia-400/15 text-fuchsia-300
            grid place-items-center shrink-0"><Sparkles size={18} /></span>
          <div className="min-w-0">
            <div className="text-slate-100 font-semibold text-sm">
              {boosts} giveaway {boosts === 1 ? 'boost' : 'boosts'} ready
            </div>
            <p className="text-slate-400 text-[13px] mt-0.5">
              {boosts === 1 ? 'It adds' : 'They add'} an extra entry to the next giveaway you
              join in Discord. Nothing to claim — it happens when the winner is drawn.
            </p>
          </div>
        </div>
      )}

      {/* Shop */}
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="text-lg text-white font-bold">Forge Shop</h2>
          <span className="text-[12.5px] text-slate-500">
            Codes are single-use and never expire.
          </span>
        </div>
        {/* Four across on a wide screen. The page was capped at max-w-3xl, so on
            a 1400px window the content sat in 770px and the right half of the
            screen was empty. Ordered cheapest first, so the one a shopper can
            actually reach is the one they read first. */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {shop.map((r) => {
            const Icon = ICON[r.kind] || Ticket;
            const afford = balance >= r.cost;
            const pct = Math.min(100, Math.round((balance / r.cost) * 100));
            const away = spendToReach(r.cost);
            const best = r.id === bestValueId;
            return (
              <div key={r.id}
                className={`relative rounded-2xl border p-5 flex flex-col transition
                  ${afford
                    ? 'border-amber-400/30 bg-gradient-to-b from-amber-400/[0.07] to-transparent hover:border-amber-400/50'
                    : 'border-white/10 bg-elevated/40 hover:border-white/20'}`}>
                {best && (
                  <span className="absolute -top-2.5 right-4 rounded-full bg-amber-400/15
                    border border-amber-400/35 px-2 py-0.5 text-[10.5px] font-bold uppercase
                    tracking-wider text-amber-300">
                    Best value
                  </span>
                )}

                <div className="flex items-center gap-3 mb-3">
                  <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 transition
                    ${afford
                      ? 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30'
                      : 'bg-white/5 text-slate-500 ring-1 ring-white/10'}`}>
                    <Icon size={19} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-white leading-tight">{r.label}</div>
                    <div className="inline-flex items-center gap-1 text-amber-300/90 text-[13px]
                      font-bold tabular-nums mt-0.5">
                      <Coins size={13} /> {r.cost}
                    </div>
                  </div>
                </div>

                <p className="text-slate-400 text-[13px] leading-relaxed flex-1">{r.blurb}</p>

                {/* How close you are, and what closing the gap actually takes.
                    "Need 15 more" on a dead grey button says the door is shut;
                    this says how far along you are and what it costs to finish,
                    both from numbers the page is already holding. */}
                <div className="mt-4">
                  {afford ? (
                    <button onClick={() => redeem(r)} disabled={busy === r.id}
                      className="btn-primary w-full text-sm font-semibold rounded-xl py-2.5">
                      {busy === r.id ? '…' : 'Redeem'}
                    </button>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between text-[11.5px] mb-1.5">
                        <span className="text-slate-500 tabular-nums">{pct}%</span>
                        <span className="text-slate-500">
                          ≈ {money(Math.round(away * 100))} more spent
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300
                          transition-[width] duration-700"
                          style={{ width: `${pct}%` }} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      <div className="rounded-2xl border border-white/10 bg-elevated/40 p-5">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <History size={16} className="text-slate-400" /> History
          </h3>
          {data.history?.length > 0 && (
            <span className="text-[12px] text-slate-500">last {data.history.length}</span>
          )}
        </div>

        {(!data.history || data.history.length === 0) ? (
          /* An empty ledger is not an error, and it is the state most members
             are in. It gets the one sentence that explains how to leave it,
             with the rate from the payload rather than typed in again. */
          <div className="flex items-start gap-3 rounded-xl bg-space-black/40 px-4 py-4">
            <span className="w-9 h-9 rounded-lg bg-white/5 text-slate-500 grid place-items-center shrink-0">
              <Coins size={17} />
            </span>
            <div>
              <div className="text-slate-300 text-sm font-medium">No coins yet</div>
              <p className="text-slate-500 text-[13px] mt-0.5">
                They arrive on their own — one for every {money(data.perCoinCents ?? 1000)} of a
                paid order. Nothing to sign up for.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {data.history.map((h, i) => {
              const code = h.reason === 'redeem' && /^FORGE[A-Z0-9]+$/.test(h.ref || '') ? h.ref : null;
              const up = h.delta > 0;
              return (
                <div key={i} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0
                      ${up ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {up ? <Coins size={15} /> : <Ticket size={15} />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-slate-200 truncate">{REASON[h.reason] || h.reason}</div>
                      <div className="text-slate-500 text-xs">{dateShort(h.createdAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {code && (
                      <button onClick={() => copy(code)}
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-amber-300
                          bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1
                          hover:bg-amber-500/20 transition">
                        {code} {copied === code ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                    <span className={`font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {up ? '+' : ''}{h.delta}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* The page is about earning and had no way to go and earn. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl
        border border-white/10 bg-elevated/40 px-5 py-4">
        <p className="text-slate-400 text-[13px] max-w-xl">
          Redeemed a code? It stays in your <b className="text-slate-300">History</b> above — copy
          it any time and use it at checkout. Codes are single-use and never expire.
        </p>
        <Link to="/shop" className="btn-primary text-sm font-semibold rounded-xl px-4 py-2.5
          whitespace-nowrap">
          Browse the shop
        </Link>
      </div>
    </div>
  );
}
