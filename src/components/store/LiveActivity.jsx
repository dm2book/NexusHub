import { Activity, Zap, CheckCircle2, Clock, Gauge, BadgeCheck } from 'lucide-react';
import { useLiveFeed, useTrustStats, deliveryPhrase, timeAgo } from '../../lib/useSocialProof.js';
import { iconFor } from '../../lib/sampleCatalog.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const secs = (s) => (s == null ? '—' : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);

/**
 * "Live on ForgeMarket" — a real recently-delivered feed + real trust stats.
 * Everything here is database-backed; if the store has no completed orders yet,
 * the whole block hides itself rather than show fake activity.
 */
export default function LiveActivity() {
  const feed = useLiveFeed();
  const stats = useTrustStats();

  const hasFeed = feed && feed.length > 0;
  const hasStats = stats && (stats.delivered > 0 || stats.reviews > 0);
  if (!hasFeed && !hasStats) return null;

  const STATS = stats ? [
    { icon: CheckCircle2, value: `${fmt(stats.delivered)}`, label: 'Orders delivered', color: 'text-violet-600 bg-violet-100' },
    { icon: Clock, value: secs(stats.avgDeliverySeconds), label: 'Average delivery', color: 'text-emerald-600 bg-emerald-100' },
    { icon: Gauge, value: secs(stats.fastestDeliverySeconds), label: 'Fastest delivery', color: 'text-amber-600 bg-amber-100' },
    { icon: BadgeCheck, value: `${fmt(stats.verifiedBuyers)}`, label: 'Verified reviews', color: 'text-blue-600 bg-blue-100' },
  ] : [];

  return (
    <section className="mb-12">
      <div className="flex items-center gap-2 mb-5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <h2 className="text-2xl font-extrabold text-slate-900">Live on ForgeMarket</h2>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Recently delivered feed */}
        {hasFeed && (
          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500 mb-3">
              <Activity size={15} className="text-violet-500" /> Recently delivered
            </div>
            <ul className="divide-y divide-slate-100">
              {feed.slice(0, 6).map((r) => {
                const img = iconFor(r.category);
                const delivered = deliveryPhrase(r.deliverySeconds);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-9 h-9 rounded-lg bg-slate-50 grid place-items-center shrink-0">
                      {img ? <img src={img} alt="" className="w-6 h-6 object-contain" /> : <CheckCircle2 size={16} className="text-emerald-500" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800 truncate">
                        <span className="font-semibold text-violet-600">{r.city ? `${r.name} from ${r.city}` : r.name}</span> got {r.item}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        {delivered ? <><Zap size={10} className="text-amber-500" /> Delivered in {delivered}</> : <>Delivered</>} · {timeAgo(r.secondsAgo)}
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
