import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LayoutDashboard, Search } from 'lucide-react';
import { useEffect } from 'react';
import { useCart } from '../context/CartContext.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Confetti from '../components/Confetti.jsx';
import { feedback } from '../lib/feedback.js';

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const { clear } = useCart();
  const { user } = useAuth();
  const { t } = useI18n();
  const orderId = params.get('order');
  const number = params.get('n');

  useEffect(() => { clear(); feedback('success'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="section py-28 text-center relative overflow-hidden">
      <Confetti />
      <div className="orb w-96 h-96 bg-emerald-500/15 -top-20 left-1/3" />
      <div className="relative max-w-lg mx-auto">
        <div className="fm-pop w-20 h-20 rounded-3xl mx-auto flex items-center justify-center mb-6 bg-emerald-500/15 border border-emerald-500/30"
          style={{ viewTransitionName: 'order-summary' }}>
          <CheckCircle2 size={40} className="text-emerald-400" />
        </div>
        <h1 className="text-3xl text-white">{t('success.title', 'Payment received 🎉')}</h1>
        <p className="text-slate-400 mt-3">
          {t('success.thanks', 'Thanks! Your order')}{number ? <> <span className="font-mono text-white">{number}</span></> : ''} {t('success.body', 'is confirmed and now being prepared. Digital deliveries appear automatically once fulfilled.')}
        </p>
        <div className="mt-6 mx-auto max-w-sm rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-4 text-left">
          <div className="text-white text-sm font-semibold">💬 {t('success.discord', 'Join our Discord')}</div>
          <p className="text-slate-400 text-[13px] mt-1">
            {t('success.discordSub', 'Live restock pings, flash deals & giveaways — and instant support if you need us.')}
          </p>
          <Link to="/discord" className="inline-flex items-center gap-1.5 mt-2.5 text-sm font-semibold text-white rounded-lg px-3.5 py-2"
            style={{ background: '#5865F2' }}>{t('success.join', 'Join the community →')}</Link>
        </div>
        <div className="flex justify-center gap-3 mt-8">
          {user && orderId
            ? <Link to={`/account/orders/${orderId}`} className="btn-primary"><LayoutDashboard size={18} /> {t('success.viewOrder', 'View order')}</Link>
            : number
              ? <Link to={`/track?number=${encodeURIComponent(number)}`} className="btn-primary"><Search size={18} /> {t('footer.track', 'Track order')}</Link>
              : <Link to="/shop" className="btn-primary">{t('cart.continue', 'Continue shopping')}</Link>}
          <Link to="/shop" className="btn-ghost">{t('checkout.keepShopping', 'Keep shopping')}</Link>
        </div>
      </div>
    </div>
  );
}
