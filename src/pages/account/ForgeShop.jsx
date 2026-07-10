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

  return (
    <div className="max-w-3xl space-y-6">
      {/* Balance header */}
      <div className="rounded-2xl p-6 text-white shadow-lg shadow-amber-500/20 relative overflow-hidden"
        style={{ backgroundImage: 'linear-gradient(120deg,#f59e0b,#f43f5e)' }}>
        <div className="flex items-center gap-4">
          <span className="w-14 h-14 rounded-2xl bg-white/15 grid place-items-center"><Coins size={28} /></span>
          <div>
            <div className="text-sm text-white/80">Your Forge Coins</div>
            <div className="text-4xl font-extrabold leading-none">{data.balance}</div>
          </div>
        </div>
        <p className="text-white/85 text-sm mt-4">Earn <b>1 coin for every €10</b> you spend — automatically. Spend them below on discount codes and giveaway boosts.</p>
      </div>

      {/* Shop */}
      <div>
        <h2 className="text-lg text-white font-bold mb-3">Forge Shop</h2>
        <div className="grid sm:grid-cols-2 gap-4">
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
                <div className="flex items-center justify-between mt-4">
                  <span className="inline-flex items-center gap-1.5 text-amber-300 font-bold"><Coins size={15} /> {r.cost}</span>
                  <button onClick={() => redeem(r)} disabled={!afford || busy === r.id}
                    className={`text-sm font-semibold rounded-xl px-4 py-2 transition ${afford ? 'btn-primary' : 'bg-white/5 text-slate-500 cursor-not-allowed'}`}>
                    {busy === r.id ? '…' : afford ? 'Redeem' : `Need ${r.cost - data.balance} more`}
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
            {data.history.map((h, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="text-slate-200">{REASON[h.reason] || h.reason}</div>
                  <div className="text-slate-500 text-xs">{date(h.createdAt)}</div>
                </div>
                <span className={`font-bold ${h.delta > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-slate-500 text-xs">Redeemed a discount code? Find it under <b className="text-slate-400">Redeem</b> above — copy it and use it at checkout. Codes are single-use and tied to your account.</p>
    </div>
  );
}
