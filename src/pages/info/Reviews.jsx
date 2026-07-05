import { Link } from 'react-router-dom';
import { Star, BadgeCheck } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { useReviews } from '../../lib/useReviews.js';
import { useStats } from '../../lib/useStats.js';
import { useI18n } from '../../lib/i18n.jsx';

export default function Reviews() {
  const reviews = useReviews();
  const stats = useStats();
  const { t } = useI18n();
  const avgDelivery = stats.avgDeliverySeconds == null ? '—'
    : stats.avgDeliverySeconds < 60 ? `< ${Math.max(1, Math.round(stats.avgDeliverySeconds))}s`
    : `${Math.round(stats.avgDeliverySeconds / 60)}m`;
  const fmt = (n) => `${Number(n || 0).toLocaleString('en-US')}${Number(n || 0) >= 100 ? '+' : ''}`;

  return (
    <InfoShell eyebrow={t('reviews.eyebrow', 'Loved by gamers')} title={t('reviews.title', 'Customer reviews')}
      subtitle={t('reviews.sub', 'Real feedback from verified buyers and our Discord community vouches.')} narrow={false}>
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
                <div className="text-white text-sm flex items-center gap-1">
                  {r.author} <BadgeCheck size={13} className="text-emerald-400" />
                </div>
                <div className="text-slate-500 text-xs flex items-center gap-1">
                  {r.verified
                    ? <span className="text-emerald-400 font-semibold">{t('product.verifiedBuyer', 'Verified buyer')}</span>
                    : t('product.verifiedShort', 'Verified')}{r.product ? ` · ${r.product}` : (!r.verified ? ' · Discord vouch' : '')}
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
