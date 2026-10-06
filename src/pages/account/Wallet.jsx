import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet as WalletIcon, ArrowUpRight, ArrowDownRight, Gift, RotateCcw,
  Plus, ShoppingBag, Sparkles, Info,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

// Visual treatment per ledger entry type.
const TX_META = {
  referral: { icon: Gift, labelKey: 'acc.wallet.tx.referral', label: 'Referral commission', tone: 'text-emerald-400 bg-emerald-500/10' },
  grant: { icon: Plus, labelKey: 'acc.wallet.tx.grant', label: 'Credit added', tone: 'text-emerald-400 bg-emerald-500/10' },
  refund: { icon: RotateCcw, labelKey: 'acc.wallet.tx.refund', label: 'Refund to credit', tone: 'text-emerald-400 bg-emerald-500/10' },
  spend: { icon: ShoppingBag, labelKey: 'acc.wallet.tx.spend', label: 'Applied to order', tone: 'text-fuchsia-400 bg-fuchsia-500/10' },
  adjustment: { icon: Info, labelKey: 'acc.wallet.tx.adjustment', label: 'Adjustment', tone: 'text-slate-300 bg-white/5' },
};

export default function Wallet() {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [data, setData] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/api/account/wallet').then(setData).catch(() => setData(false));
  useEffect(() => { load(); }, []);

  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try { const r = await api.post('/api/account/wallet/redeem', { code: code.trim() }); toast.success(t('acc.wallet.redeemed', 'Added {amount} to your wallet!', { amount: money(r.redeemed, 'EUR') })); setCode(''); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (data === null) return <PageLoader />;
  if (!data) return <div className="card p-8 text-slate-400">{t('acc.wallet.loadError', 'Couldn’t load your wallet.')}</div>;

  const { balance, lifetimeEarned, lifetimeSpent, transactions } = data;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl text-white">{t('acc.wallet.title', 'Wallet')}</h1>
        <p className="text-slate-400 text-sm mt-1">{t('acc.wallet.subtitle', 'Store credit you can spend at checkout — earned from referrals, refunds and rewards.')}</p>
      </div>

      {/* Balance hero */}
      <div className="relative overflow-hidden rounded-2xl p-6 sm:p-7 text-white shadow-xl shadow-indigo-900/30"
        style={{ backgroundImage: 'linear-gradient(135deg,#4f46e5,#7c3aed 55%,#a21caf)' }}>
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute right-6 top-6 opacity-80"><WalletIcon size={26} /></div>
        <div className="text-white/70 text-sm">{t('acc.wallet.available', 'Available balance')}</div>
        <div className="text-4xl sm:text-5xl font-display mt-1 tracking-tight">{money(balance, 'EUR')}</div>
        <div className="flex gap-6 mt-6">
          <div>
            <div className="text-white/60 text-xs uppercase tracking-wide">{t('acc.wallet.lifetimeEarned', 'Lifetime earned')}</div>
            <div className="text-lg font-semibold mt-0.5 flex items-center gap-1"><ArrowUpRight size={15} /> {money(lifetimeEarned, 'EUR')}</div>
          </div>
          <div>
            <div className="text-white/60 text-xs uppercase tracking-wide">{t('acc.wallet.lifetimeSpent', 'Lifetime spent')}</div>
            <div className="text-lg font-semibold mt-0.5 flex items-center gap-1"><ArrowDownRight size={15} /> {money(lifetimeSpent, 'EUR')}</div>
          </div>
        </div>
      </div>

      {/* Redeem a gift card */}
      <div className="card p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <label className="label flex items-center gap-1.5"><Gift size={13} className="text-pink-400" /> {t('acc.wallet.redeemTitle', 'Redeem a gift card')}</label>
          <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="GIFT-XXXX-XXXX-XXXX-XXXX" onKeyDown={(e) => e.key === 'Enter' && redeem()} />
        </div>
        <button onClick={redeem} disabled={busy || !code.trim()} className="btn-primary sm:w-40 py-2.5">{busy ? t('acc.wallet.redeeming', 'Redeeming…') : t('acc.wallet.redeem', 'Redeem')}</button>
      </div>

      {/* How to earn */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { icon: Gift, title: t('acc.wallet.earn.refer', 'Refer friends'), text: t('acc.wallet.earn.referText', 'Earn commission as credit'), to: '/account/referrals' },
          { icon: Sparkles, title: t('acc.wallet.earn.spend', 'Spend at checkout'), text: t('acc.wallet.earn.spendText', 'Apply credit to any order'), to: '/shop' },
          { icon: RotateCcw, title: t('acc.wallet.earn.refunds', 'Refunds as credit'), text: t('acc.wallet.earn.refundsText', 'Instant, no waiting'), to: '/account/orders' },
        ].map(({ icon: Icon, title, text, to }) => (
          <Link key={title} to={to} className="card p-4 hover:border-primary/40 transition">
            <Icon size={18} className="text-primary mb-2" />
            <div className="text-white text-sm font-medium">{title}</div>
            <div className="text-slate-500 text-xs mt-0.5">{text}</div>
          </Link>
        ))}
      </div>

      {/* Transactions */}
      <div>
        <h2 className="text-lg text-white mb-3">{t('acc.wallet.history', 'Transaction history')}</h2>
        {transactions.length === 0 ? (
          <EmptyState icon={WalletIcon} title={t('acc.wallet.empty', 'No transactions yet')}
            hint={t('acc.wallet.emptyHint', 'Refer a friend or apply credit at checkout — your activity will show up here.')}
            action={<Link to="/account/referrals" className="btn-primary">{t('acc.wallet.startReferring', 'Start referring')}</Link>} />
        ) : (
          <div className="card divide-y divide-white/5">
            {transactions.map((tx) => {
              const meta = TX_META[tx.type] || TX_META.adjustment;
              const Icon = meta.icon;
              const positive = tx.amount > 0;
              return (
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${meta.tone}`}><Icon size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-sm truncate">{tx.description || t(meta.labelKey, meta.label)}</div>
                    <div className="text-slate-500 text-xs">{tx.createdAt ? new Date(tx.createdAt).toLocaleString(locale) : '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-semibold ${positive ? 'text-emerald-400' : 'text-slate-200'}`}>
                      {positive ? '+' : '−'}{money(Math.abs(tx.amount), 'EUR')}
                    </div>
                    <div className="text-slate-500 text-[11px]">{t('acc.wallet.balanceAfter', 'Balance {amount}', { amount: money(tx.balanceAfter, 'EUR') })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
