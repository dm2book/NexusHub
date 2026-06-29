import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, Copy, Users, Wallet, TrendingUp, Check, Share2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Referrals() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.get('/api/account/rewards').then(setData).catch(() => setData(false)); }, []);
  if (data === null) return <PageLoader />;
  if (!data) return <div className="card p-8 text-slate-400">Couldn’t load your referral program.</div>;

  const a = data.affiliate;
  const refLink = `${window.location.origin}/?ref=${a.code}`;
  const copy = (text, label) => { navigator.clipboard?.writeText(text); setCopied(true); toast.success(label); setTimeout(() => setCopied(false), 1500); };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'ForgeMarket', text: 'Get game currency & gift cards, delivered instantly:', url: refLink }); } catch { /* cancelled */ } }
    else copy(refLink, 'Referral link copied');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl text-white">Referral program</h1>
        <p className="text-slate-400 text-sm mt-1">Share your link and earn <span className="text-white font-medium">{a.commissionPercent}%</span> of every order your friends make — paid straight to your <Link to="/account/wallet" className="text-indigo-400 hover:underline">wallet</Link> as store credit.</p>
      </div>

      {/* Code + link */}
      <div className="card p-6">
        <label className="label">Your referral code</label>
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span className="font-mono text-2xl text-white tracking-[0.2em] bg-space-black rounded-xl px-4 py-2 border border-white/10">{a.code}</span>
          <button onClick={() => copy(a.code, 'Code copied')} className="btn-ghost text-sm"><Copy size={15} /> Copy code</button>
        </div>

        <label className="label">Your referral link</label>
        <div className="flex gap-2">
          <input readOnly value={refLink} className="input font-mono text-sm" />
          <button onClick={() => copy(refLink, 'Referral link copied')} className="btn-primary px-4">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
          <button onClick={share} className="btn-ghost px-4" aria-label="Share"><Share2 size={15} /></button>
        </div>
      </div>

      {/* Earnings KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={Users} label="Referrals" value={a.referrals} />
        <Kpi icon={TrendingUp} label="Orders" value={a.orders} />
        <Kpi icon={Wallet} label="Earned" value={money(a.totalCommission, 'EUR')} accent />
        <Kpi icon={Gift} label="Commission" value={`${a.commissionPercent}%`} />
      </div>

      {/* History */}
      <div>
        <h2 className="text-lg text-white mb-3">Referral history</h2>
        {(!a.recent || a.recent.length === 0) ? (
          <EmptyState icon={Gift} title="No referrals yet"
            hint="Share your link — when a friend orders, you earn credit and it shows up here."
            action={<button onClick={() => copy(refLink, 'Referral link copied')} className="btn-primary">Copy your link</button>} />
        ) : (
          <div className="card divide-y divide-white/5">
            {a.recent.map((e, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl grid place-items-center bg-pink-500/10 text-pink-400 shrink-0">
                    {e.kind === 'order' ? <Wallet size={16} /> : <Users size={16} />}
                  </span>
                  <div>
                    <div className="text-white text-sm capitalize">{e.kind === 'order' ? 'Referral order' : 'New referral'}</div>
                    <div className="text-slate-500 text-xs">{date(e.createdAt)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 text-sm font-semibold">{e.commission ? `+${money(e.commission, 'EUR')}` : '—'}</div>
                  <div className="text-slate-500 text-[11px] capitalize">{e.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent }) {
  return (
    <div className={`card p-4 text-center ${accent ? 'border border-emerald-500/30' : ''}`}>
      <Icon size={17} className={`mx-auto mb-1.5 ${accent ? 'text-emerald-400' : 'text-indigo-300'}`} />
      <div className="text-white font-semibold text-lg">{value}</div>
      <div className="text-slate-500 text-[11px] mt-0.5">{label}</div>
    </div>
  );
}
