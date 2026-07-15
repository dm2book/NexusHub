import { useEffect, useState } from 'react';
import { Gift, Crown, Copy, Users, Wallet, Star, Check, Zap, Coins } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const TIER_COLORS = { bronze: '#cd7f32', silver: '#9ca3af', gold: '#f59e0b', platinum: '#a78bfa' };

export default function Rewards() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/account/rewards').then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, []);
  if (data === null) return <PageLoader />;
  if (!data) return <div className="card p-8 text-slate-400">Couldn’t load rewards.</div>;

  const { loyalty, affiliate, membership, walletBalance = 0, coins = 0 } = data;
  const plan = membership.plan;
  const refLink = `${window.location.origin}/?ref=${affiliate.code}`;
  const copy = (t, msg) => { navigator.clipboard?.writeText(t); toast.success(msg); };

  const buy = async (method) => {
    setBusy(true);
    try {
      await api.post('/api/account/membership/purchase', { method });
      toast.success(`${plan.name} activated — ${plan.discountPercent}% off every order! 👑`);
      setBuyOpen(false); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const canCredit = walletBalance >= plan.priceCents;
  const canCoins = coins >= plan.coinPrice;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl text-white">Rewards</h1>

      {/* Loyalty */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white flex items-center gap-2"><Star size={17} className="text-amber-400" /> Loyalty</h3>
          <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ background: `${loyalty.color}22`, color: loyalty.color }}>
            {loyalty.tierName}
          </span>
        </div>
        <div className="flex items-end justify-between text-sm mb-2">
          <span className="text-slate-400">Lifetime spend (XP)</span>
          <span className="text-white font-semibold">{money(loyalty.xp, 'EUR')}</span>
        </div>
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${loyalty.progress}%`, background: `linear-gradient(90deg,${loyalty.color},#a855f7)` }} />
        </div>
        {loyalty.next ? (
          <p className="text-slate-500 text-xs mt-2">{money(loyalty.remainingToNext, 'EUR')} more to reach <span className="text-white">{loyalty.next.name}</span></p>
        ) : <p className="text-slate-500 text-xs mt-2">You’ve reached the top tier 🎉</p>}
        <div className="grid grid-cols-4 gap-2 mt-5">
          {loyalty.tiers.map((t) => (
            <div key={t.id} className={`rounded-lg py-2 text-center text-xs border ${t.id === loyalty.tier ? 'border-white/30' : 'border-white/5'}`}>
              <div className="font-semibold" style={{ color: TIER_COLORS[t.id] }}>{t.name}</div>
              <div className="text-slate-500 mt-0.5">{money(t.min, 'EUR')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Forge+ membership */}
      <div className={`card p-6 ${membership.active ? 'border border-violet-500/30' : ''}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white flex items-center gap-2"><Crown size={17} className="text-violet-400" /> {membership.plan.name}</h3>
          {membership.active
            ? <span className="text-xs px-3 py-1 rounded-full bg-violet-500/20 text-violet-300">Active{membership.until ? ` · until ${date(membership.until)}` : ''}</span>
            : <span className="text-xs px-3 py-1 rounded-full bg-white/5 text-slate-400">Not a member</span>}
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {membership.plan.perks.map((p) => (
            <div key={p} className="flex items-center gap-2 text-sm text-slate-300"><Check size={14} className="text-emerald-400 shrink-0" /> {p}</div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
          <p className="text-slate-500 text-sm">
            {money(plan.priceCents, 'EUR')}/month or {plan.coinPrice} Forge Coins · instant activation.
          </p>
          <button onClick={() => setBuyOpen(true)} className="btn-primary text-sm">
            <Crown size={15} /> {membership.active ? 'Extend Forge+' : 'Get Forge+'}
          </button>
        </div>
      </div>

      <Modal open={buyOpen} onClose={() => setBuyOpen(false)} title={`${membership.active ? 'Extend' : 'Get'} ${plan.name} — 30 days`}>
        <p className="text-slate-400 text-sm mb-4">{plan.discountPercent}% off every order, priority support & fulfillment, early access to drops. Pick how you’d like to pay — it’s instant.</p>
        <div className="space-y-3">
          <button disabled={busy || !canCredit} onClick={() => buy('credit')}
            className={`w-full flex items-center justify-between rounded-xl border p-4 text-left transition ${canCredit ? 'border-white/10 hover:border-violet-500/50' : 'border-white/5 opacity-50 cursor-not-allowed'}`}>
            <span className="flex items-center gap-3"><Wallet size={18} className="text-indigo-300" />
              <span><span className="text-white font-semibold">Store credit</span><span className="block text-xs text-slate-500">Balance: {money(walletBalance, 'EUR')}</span></span>
            </span>
            <span className="text-white font-semibold">{money(plan.priceCents, 'EUR')}</span>
          </button>
          <button disabled={busy || !canCoins} onClick={() => buy('coins')}
            className={`w-full flex items-center justify-between rounded-xl border p-4 text-left transition ${canCoins ? 'border-white/10 hover:border-violet-500/50' : 'border-white/5 opacity-50 cursor-not-allowed'}`}>
            <span className="flex items-center gap-3"><Coins size={18} className="text-amber-300" />
              <span><span className="text-white font-semibold">Forge Coins</span><span className="block text-xs text-slate-500">You have {coins} coins</span></span>
            </span>
            <span className="text-white font-semibold">🪙 {plan.coinPrice}</span>
          </button>
        </div>
        {!canCredit && !canCoins && (
          <p className="text-amber-400/80 text-xs mt-3">Not enough store credit or coins yet — earn coins by ordering, or top up your wallet with a gift card.</p>
        )}
      </Modal>

      {/* Affiliate */}
      <div className="card p-6">
        <h3 className="text-white flex items-center gap-2 mb-1"><Gift size={17} className="text-pink-400" /> Refer & earn</h3>
        <p className="text-slate-400 text-sm mb-4">Share your link. You earn <span className="text-white">{affiliate.commissionPercent}%</span> commission on every order your referrals make.</p>

        <label className="label">Your referral link</label>
        <div className="flex gap-2 mb-5">
          <input readOnly value={refLink} className="input font-mono text-sm" />
          <button onClick={() => copy(refLink, 'Referral link copied')} className="btn-primary px-4"><Copy size={15} /></button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <Kpi icon={Users} label="Referrals" value={affiliate.referrals} />
          <Kpi icon={Wallet} label="Pending" value={money(affiliate.pendingCommission, 'EUR')} />
          <Kpi icon={Check} label="Paid out" value={money(affiliate.paidCommission, 'EUR')} />
        </div>
        {affiliate.recent?.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-slate-400 text-xs uppercase tracking-wide">Recent</div>
            {affiliate.recent.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-space-black rounded-lg px-3 py-2">
                <span className="text-slate-300 capitalize">{e.kind} · {date(e.createdAt)}</span>
                <span className="text-white">{e.commission ? money(e.commission, 'EUR') : '—'} <span className="text-slate-500 text-xs">{e.status}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }) {
  return (
    <div className="bg-space-black rounded-xl p-3 text-center">
      <Icon size={16} className="text-indigo-300 mx-auto mb-1" />
      <div className="text-white font-semibold">{value}</div>
      <div className="text-slate-500 text-[11px]">{label}</div>
    </div>
  );
}
