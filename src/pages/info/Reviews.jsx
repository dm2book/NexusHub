import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, BadgeCheck, PenLine } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useReviews } from '../../lib/useReviews.js';
import { useStats } from '../../lib/useStats.js';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';

/** "Write a review" — verified buyers pick one of their delivered orders. */
function WriteReview({ t }) {
  const { user } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [orderId, setOrderId] = useState('');
  const [stars, setStars] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) { setOrders([]); return; }
    api.get('/api/account/reviewable')
      .then((r) => { setOrders(r.orders || []); setOrderId(r.orders?.[0]?.id || ''); })
      .catch(() => setOrders([]));
  }, [user]);

  const submit = async () => {
    if (body.trim().length < 3) { toast.error(t('reviews.wFew', 'Please write a few words.')); return; }
    setBusy(true);
    try {
      await api.post(`/api/account/orders/${orderId}/review`, { stars, body: body.trim() });
      toast.success(t('reviews.wThanks', 'Thanks — your verified review is live!'));
      setDone(true);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (done) return null;
  return (
    <div className="max-w-xl mx-auto card p-6 mb-10">
      <h3 className="text-white font-bold flex items-center gap-2 mb-1"><PenLine size={16} className="text-violet-400" /> {t('reviews.write', 'Write a review')}</h3>
      {!user ? (
        <p className="text-slate-400 text-sm">
          {t('reviews.wLogin', 'Reviews come from real purchases only.')}{' '}
          <Link to="/login" className="text-violet-400 hover:underline">{t('reviews.wLoginCta', 'Log in')}</Link>{' '}
          {t('reviews.wLogin2', 'and once an order is delivered you can review it right here.')}
        </p>
      ) : orders === null ? (
        <p className="text-slate-500 text-sm">…</p>
      ) : orders.length === 0 ? (
        <p className="text-slate-400 text-sm">
          {t('reviews.wNone', 'No delivered orders to review yet — every review here is tied to a real purchase.')}{' '}
          <Link to="/shop" className="text-violet-400 hover:underline">{t('reviews.wShop', 'Browse the shop')}</Link>
        </p>
      ) : (
        <div className="space-y-3 mt-3">
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="input w-full">
            {orders.map((o) => <option key={o.id} value={o.id}>{o.number}{o.item ? ` — ${o.item}` : ''}</option>)}
          </select>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setStars(n)} aria-label={`${n} stars`}>
                <Star size={22} className={n <= stars ? 'text-amber-400' : 'text-slate-600'} fill={n <= stars ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          <textarea rows={3} className="input w-full" placeholder={t('reviews.wPh', 'Tell other buyers about your experience…')}
            value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} />
          <button onClick={submit} disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? '…' : t('reviews.wSubmit', 'Post verified review')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Reviews() {
  usePageMeta('Customer reviews', 'Reviews from real ForgeMarket orders, plus vouches from ForgeMarket Support on Discord.');
  const reviews = useReviews();
  const stats = useStats();
  const { t } = useI18n();
  const avgDelivery = stats.avgDeliverySeconds == null ? '—'
    : stats.avgDeliverySeconds < 60 ? `< ${Math.max(1, Math.round(stats.avgDeliverySeconds))}s`
    : `${Math.round(stats.avgDeliverySeconds / 60)}m`;
  const fmt = (n) => `${Number(n || 0).toLocaleString('en-US')}${Number(n || 0) >= 100 ? '+' : ''}`;

  return (
    <InfoShell eyebrow={t('reviews.eyebrow', 'Loved by gamers')} title={t('reviews.title', 'Customer reviews')}
      subtitle={t('reviews.sub', 'Real feedback from verified buyers, plus vouches left in ForgeMarket Support.')} narrow={false}>
      <div className="flex flex-wrap items-center justify-center gap-6 mb-10">
        {stats.reviews > 0 && (
          <>
            <div className="text-center">
              <div className="text-4xl font-display gradient-text">{stats.rating}/5</div>
              <div className="flex gap-0.5 justify-center text-amber-400 mt-1">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={16} fill="currentColor" />)}</div>
              <div className="text-slate-500 text-sm mt-1">{t('home.basedOn', 'Based on {n} reviews', { n: stats.reviews.toLocaleString('en-US') })}</div>
            </div>
            <div className="h-12 w-px bg-white/10 hidden sm:block" />
          </>
        )}
        <div className="grid grid-cols-3 gap-6 text-center">
          {[[fmt(stats.delivered), t('reviews.delivered', 'Delivered')],
            [stats.successRate != null ? `${stats.successRate}%` : '100%', stats.successRate != null ? t('home.s.fulfilled', 'Fulfilled') : t('reviews.protected', 'Protected')],
            [avgDelivery, t('reviews.avgDelivery', 'Avg. delivery')]].map(([n, l]) => (
            <div key={l}><div className="text-2xl font-display text-white">{n}</div><div className="text-slate-500 text-xs">{l}</div></div>
          ))}
        </div>
      </div>

      <WriteReview t={t} />

      {reviews.length === 0 && (
        <div className="max-w-md mx-auto text-center card p-8 text-slate-400">
          {t('reviews.none', 'No reviews yet — verified buyer reviews will appear here automatically after orders are delivered.')}
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {reviews.map((r) => (
          <div key={r.id} className="card p-6 fm-lift">
            <div className="flex gap-0.5 mb-3 text-amber-400">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={14} fill="currentColor" />)}</div>
            <p className="text-slate-200">“{r.body}”</p>
            <div className="flex items-center gap-3 mt-5">
              {r.avatarUrl
                ? <img src={r.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                : <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-semibold">{(r.author || '?')[0]}</div>}
              <div>
                {/* The checkmark means "we matched this to a delivered order".
                    A Discord vouch has no order behind it, so it gets neither
                    the badge nor the word "verified". */}
                <div className="text-white text-sm flex items-center gap-1">
                  {r.author} {r.verified && <BadgeCheck size={13} className="text-emerald-400" />}
                </div>
                <div className="text-slate-500 text-xs flex items-center gap-1">
                  {r.verified
                    ? <span className="text-emerald-400 font-semibold">{t('product.verifiedBuyer', 'Verified buyer')}</span>
                    : t('reviews.discordVouch', 'Discord vouch')}{r.product ? ` · ${r.product}` : ''}
                  {r.city ? ` · ${r.city}` : ''}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-center mt-10"><Link to="/shop" className="btn-primary px-7 py-3.5">{t('reviews.cta', 'Shop with confidence')}</Link></div>
    </InfoShell>
  );
}
