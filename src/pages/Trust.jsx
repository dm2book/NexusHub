import { Link } from 'react-router-dom';
import {
  ShieldCheck, Zap, Clock, Star, RotateCcw, Lock, MessageCircle, BadgeCheck,
  Users, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { useStats } from '../lib/useStats.js';
import { useReviews } from '../lib/useReviews.js';
import { usePageMeta } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';
import LiveActivity from '../components/store/LiveActivity.jsx';

const guarantees = (t) => [
  { icon: Zap, title: t('trust.g1t', 'Fast, tracked delivery'),
    text: t('trust.g1', 'Items we hold in stock are sent automatically the moment your payment is confirmed. Everything else is delivered by hand, and you can follow the status of your order at any time.') },
  { icon: Lock, title: t('trust.g2t', 'Secure by design'),
    text: t('trust.g2', 'Passwordless login, encrypted sessions with one-time-use refresh tokens, and continuous fraud screening on every order.') },
  { icon: RotateCcw, title: t('trust.g3t', 'Money-back guarantee'),
    text: t('trust.g3', "If we can't deliver your order, you get a full refund — no questions asked.") },
  { icon: BadgeCheck, title: t('trust.g4t', 'Reviews you can check'),
    text: t('trust.g4', 'Reviews marked "Verified buyer" are tied to a real, completed order. Community vouches from our Discord are shown separately and never carry that badge.') },
];

const faq = (t) => [
  [t('trust.q1', 'How fast is delivery?'),
   // Was "within seconds" — the same claim the rest of the site stopped making.
   t('trust.a1', 'Items we have in stock are sent automatically once your payment is confirmed. Anything else we buy in and deliver by hand, usually within a few hours during the day. You can follow the status live on your order page.')],
  [t('trust.q2', 'How do I pay?'),
   t('trust.a2', 'You place the order, then pay the amount shown with your order number as the reference. We confirm every payment by hand — usually within minutes during the day.')],
  [t('trust.q3', 'What if something goes wrong?'),
   t('trust.a3', 'Open a ticket in our Discord or reply to your order email. If we cannot deliver, you get your money back.')],
  [t('trust.q4', 'Are the reviews real?'),
   t('trust.a4', 'Reviews marked as verified are tied to a real, completed order. Community vouches from Discord are shown separately and never carry that badge.')],
];

function Stat({ icon: Icon, value, label, color }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 text-center fm-lift">
      <span className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3 ${color}`}><Icon size={22} /></span>
      <div className="text-3xl font-extrabold text-slate-900">{value}</div>
      <div className="text-slate-500 text-sm mt-1">{label}</div>
    </div>
  );
}

export default function Trust() {
  const stats = useStats();
  const reviews = useReviews();
  const { t } = useI18n();
  usePageMeta('Trust Center — ForgeMarket', 'Delivery, review and refund statistics, security guarantees and proof you can trust ForgeMarket.');
  const avgDelivery = stats.avgDeliverySeconds == null ? '—'
    : stats.avgDeliverySeconds < 60 ? `< ${Math.max(1, Math.round(stats.avgDeliverySeconds))}s`
    : `${Math.round(stats.avgDeliverySeconds / 60)}m`;
  const fmt = (n) => `${Number(n || 0).toLocaleString('en-US')}${Number(n || 0) >= 100 ? '+' : ''}`;

  return (
    <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-10">
      {/* Hero */}
      <div className="text-center mb-10">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-violet-700 bg-violet-100 rounded-full px-3 py-1.5">
          <ShieldCheck size={14} /> {t('trust.badge', 'Trust Center')}
        </span>
        <h1 className="text-4xl font-extrabold text-slate-900 mt-4">{t('trust.title', 'How your purchase is protected')}</h1>
        <p className="text-slate-500 mt-3 max-w-xl mx-auto">{t('trust.sub', 'Real numbers and real guarantees — exactly how we keep every order safe and protected.')}</p>
      </div>

      {/* Live stats (real only — cards without data hide themselves) */}
      {(() => {
        const cards = [
          { icon: CheckCircle2, value: fmt(stats.delivered), label: t('trust.sDelivered', 'Orders delivered'), color: 'text-violet-600 bg-violet-100' },
          { icon: Clock, value: avgDelivery, label: t('trust.sAvg', 'Average delivery'), color: 'text-emerald-600 bg-emerald-100' },
          // Real fulfilment success rate — only once orders have finished.
          stats.successRate != null
            ? { icon: ShieldCheck, value: `${stats.successRate}%`, label: t('trust.sSuccess', 'Successfully delivered'), color: 'text-emerald-600 bg-emerald-100' }
            : null,
          { icon: Star, value: stats.reviews > 0 ? `${stats.rating}/5` : '—', label: stats.reviews > 0 ? `${stats.reviews.toLocaleString('en-US')} ${t('trust.sReviews', 'reviews')}` : t('trust.sNoReviews', 'No reviews yet'), color: 'text-amber-600 bg-amber-100' },
          // Was `: '24/7'` when the member count is unset (the default). One
          // person cannot staff 24/7, and presenting it as a statistic on the
          // page called Trust Center is the worst possible place to overreach.
          stats.discordMembers > 0
            ? { icon: Users, value: stats.discordMembers.toLocaleString('en-US'), label: t('trust.sMembers', 'Discord members'), color: 'text-blue-600 bg-blue-100' }
            : null,
        ].filter(Boolean);
        return (
          <div className={`grid grid-cols-2 ${cards.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4 mb-12`}>
            {cards.map((c) => <Stat key={c.label} icon={c.icon} value={c.value} label={c.label} color={c.color} />)}
          </div>
        );
      })()}

      {/* Live, database-backed activity (hides itself until there's real data) */}
      <LiveActivity />

      {/* Guarantees */}
      <h2 className="text-2xl font-extrabold text-slate-900 mb-5">{t('trust.guarantees', 'Our guarantees')}</h2>
      <div className="grid sm:grid-cols-2 gap-4 mb-12">
        {guarantees(t).map((g) => (
          <div key={g.title} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 flex gap-4 fm-lift">
            <span className="w-11 h-11 rounded-xl grid place-items-center bg-violet-100 text-violet-600 shrink-0"><g.icon size={20} /></span>
            <div>
              <h3 className="font-bold text-slate-900">{g.title}</h3>
              <p className="text-slate-500 text-sm mt-1 leading-relaxed">{g.text}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Discord proof */}
      <div className="rounded-2xl p-7 mb-12 text-white shadow-lg shadow-indigo-500/20 flex flex-col sm:flex-row sm:items-center gap-5"
        style={{ backgroundImage: 'linear-gradient(150deg,#6366f1,#8b5cf6)' }}>
        <span className="w-14 h-14 rounded-2xl bg-white/15 grid place-items-center shrink-0"><MessageCircle size={26} /></span>
        <div className="flex-1">
          <h3 className="text-xl font-extrabold">
            {stats.discordMembers > 0
              ? `${stats.discordMembers.toLocaleString('en-US')} ${t('trust.membersVouch', 'members can vouch for us')}`
              : t('trust.joinVouch', 'Ask real buyers before you buy')}
          </h3>
          <p className="text-white/85 text-sm mt-1">{t('trust.discordSub', 'Public reviews, proof of delivery, and buyers you can ask before you spend a cent.')}</p>
        </div>
        <Link to="/discord" className="inline-flex items-center justify-center gap-2 bg-white text-indigo-600 font-semibold text-sm rounded-xl h-11 px-6 hover:bg-indigo-50 transition shrink-0">
          {t('trust.joinDiscord', 'Join Discord')} <ArrowRight size={16} />
        </Link>
      </div>

      {/* Recent verified reviews (only when we have real ones) */}
      {reviews.length > 0 && (
        <>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-5">{t('trust.verifiedReviews', 'Verified customer reviews')}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            {reviews.slice(0, 6).map((r) => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 fm-lift">
                <div className="flex text-amber-400 mb-2">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={14} fill="currentColor" />)}</div>
                <p className="text-slate-600 text-sm">"{r.body}"</p>
                <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                  {/* The green check used to render on every review; only the
                      words were gated. A checkmark next to a name reads as
                      verification on its own. */}
                  {r.verified && <BadgeCheck size={13} className="text-emerald-500" />} {r.author}{r.product ? ` · ${r.product}` : ''}
                  {r.verified ? <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">· {t('trust.verifiedBuyer', 'Verified buyer')}</span> : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* FAQ */}
      <h2 className="text-2xl font-extrabold text-slate-900 mb-5">{t('trust.faqTitle', 'Questions, answered')}</h2>
      <div className="space-y-3 mb-10">
        {faq(t).map(([q, a]) => (
          <div key={q} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900">{q}</h3>
            <p className="text-slate-500 text-sm mt-1.5 leading-relaxed">{a}</p>
          </div>
        ))}
      </div>

      <div className="text-center">
        <Link to="/shop" className="inline-flex items-center gap-2 text-white font-semibold rounded-xl px-7 h-12 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
          style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
          {t('trust.cta', 'Shop with confidence')} <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}
