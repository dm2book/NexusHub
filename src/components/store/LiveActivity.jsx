import { Activity, Zap, CheckCircle2, Clock, BadgeCheck } from 'lucide-react';
import { useLiveFeed, useTrustStats, timeAgo } from '../../lib/useSocialProof.js';
import { iconFor } from '../../lib/sampleCatalog.js';
import { useI18n } from '../../lib/i18n.jsx';
import { durationText } from '../../lib/trustLines.js';
import { FRESH_SECONDS } from './RecentlyDelivered.jsx';

/**
 * "Live on ForgeMarket" — a real recently-delivered feed + real trust stats.
 * Everything here is database-backed; if the store has no completed orders yet,
 * the whole block hides itself rather than show fake activity.
 *
 * A tile appears only with a number behind it — no "—" standing in for one.
 * "Fastest delivery" is gone: the single best order the shop ever had is a
 * real figure and still the wrong one to show a buyer, who gets a typical
 * order, not the luckiest. The delivery time is the median, over how many
 * orders, from payment to delivery (server: deliveryTimes).
 */
export default function LiveActivity() {
  const { t, locale } = useI18n();
  const feed = useLiveFeed();
  const stats = useTrustStats();
  const fmt = (n) => Number(n || 0).toLocaleString(locale);

  const hasFeed = feed && feed.length > 0;
  const STATS = stats ? [
    stats.delivered > 0
      ? { icon: CheckCircle2, value: fmt(stats.delivered), label: t('trust.sDelivered', 'Orders delivered'), color: 'text-violet-600 bg-violet-100' }
      : null,
    stats.medianDeliverySeconds != null
      ? { icon: Clock, value: durationText(stats.medianDeliverySeconds, t),
          label: t('trust.sMedian', 'Median time from payment to delivery · {n} orders', { n: fmt(stats.deliverySample) }),
          color: 'text-emerald-600 bg-emerald-100' }
      : null,
    stats.verifiedBuyers > 0
      ? { icon: BadgeCheck, value: fmt(stats.verifiedBuyers), label: t('trust.sVerified', 'Verified reviews'), color: 'text-blue-600 bg-blue-100' }
      : null,
  ].filter(Boolean) : [];
  const hasStats = STATS.length > 0;
  if (!hasFeed && !hasStats) return null;

  /* The pulsing dot says "this is happening now". It pulses only while the
     newest delivery is recent (the same 48 hours the floating ticker uses);
     after a quiet spell it is a plain dot, not a heartbeat. */
  const fresh = hasFeed && feed.some((r) => Number(r.secondsAgo) <= FRESH_SECONDS);

  return (
    <section className="mb-12">
      <div className="flex items-center gap-2 mb-5">
        <span className="relative flex h-2.5 w-2.5">
          {fresh && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${fresh ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        </span>
        <h2 className="text-2xl font-extrabold text-slate-900">{t('live.title', 'Live on ForgeMarket')}</h2>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Recently delivered feed */}
        {hasFeed && (
          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500 mb-3">
              <Activity size={15} className="text-violet-500" /> {t('live.recent', 'Recently delivered')}
            </div>
            <ul className="divide-y divide-slate-100">
              {feed.slice(0, 6).map((r) => {
                const img = iconFor(r.category);
                // Payment → delivery for this order, or nothing when either moment is missing.
                const delivered = r.deliverySeconds ? durationText(r.deliverySeconds, t) : null;
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-9 h-9 rounded-lg bg-slate-50 grid place-items-center shrink-0">
                      {img ? <img src={img} alt="" className="w-6 h-6 object-contain" /> : <CheckCircle2 size={16} className="text-emerald-500" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800 truncate">
                        <span className="font-semibold text-violet-600">{r.city ? `${r.name || t('live.someone', 'Someone')} ${t('live.from', 'from')} ${r.city}` : (r.name || t('live.someone', 'Someone'))}</span> {t('live.got', 'got')} {r.item}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1">
                        {delivered ? <><Zap size={10} className="text-amber-500" /> {t('live.deliveredIn', 'Delivered in')} {delivered}</> : <>{t('live.delivered', 'Delivered')}</>} · {timeAgo(r.secondsAgo)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Real trust stats */}
        {hasStats && (
          <div className="grid grid-cols-2 gap-4 content-start">
            {STATS.map(({ icon: Icon, value, label, color }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 text-center fm-lift">
                <span className={`w-11 h-11 rounded-xl grid place-items-center mx-auto mb-2.5 ${color}`}><Icon size={20} /></span>
                <div className="text-2xl font-extrabold text-slate-900">{value}</div>
                <div className="text-slate-500 text-xs mt-1">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
