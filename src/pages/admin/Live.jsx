import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Euro, Percent, ShoppingCart, ShieldAlert, Undo2, PackageX,
  Boxes, UserPlus, Repeat, Megaphone, RefreshCw, Dot,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * The launch command centre.
 *
 * ── WHY IT POLLS, AND SAYS SO ─────────────────────────────────────────────
 * There is no push. This shop is one serverless function on Vercel, where a
 * held-open SSE stream is an invocation billed by the second and killed at the
 * function's max duration — it would drop on a timer and leave a frozen number
 * looking live, which is worse than no number. So this polls a cheap endpoint
 * and renders THE AGE OF WHAT IT HAS. "Updated 4s ago" is a fact; a green dot
 * labelled "live" is decoration.
 *
 * Polling stops when the tab is hidden. A laptop left open on this page
 * overnight is otherwise a request every ten seconds until morning, against a
 * database billed by the hour — and none of those requests is ever read.
 *
 * ── AND THE HOUSE RULES ───────────────────────────────────────────────────
 * Nulls render as "—", never as 0 or €0.00. The admin shell is DARK
 * (`theme-light` comes from StoreLayout, not from here), so body copy is
 * slate-300/400 and headings are white; slate-900 on this surface measures
 * 1.06:1.
 */

const POLL_MS = 10_000;

const eur = (c) => (c == null ? '—' : money(c, 'EUR'));
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

function relAge(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** One number. `tone` only ever reflects the data, never decoration. */
function Tile({ icon: Icon, label, value, sub, tone = 'plain' }) {
  const ring = {
    plain: 'border-white/[0.06]',
    good: 'border-emerald-500/25',
    warn: 'border-amber-500/30',
    bad: 'border-red-500/35',
  }[tone];
  const text = {
    plain: 'gradient-text',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-red-300',
  }[tone];
  return (
    <div className={`card p-5 border ${ring}`}>
      <div className="flex items-center gap-2 text-slate-400 text-sm">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-3xl font-display mt-1 ${text}`}>{value}</div>
      {sub && <div className="text-slate-400 text-xs mt-1 leading-snug">{sub}</div>}
    </div>
  );
}

export default function Live() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;           // a slow answer must not stack requests
    busy.current = true;
    try {
      const r = await api.get('/api/admin/launch-center');
      setD(r); setFetchedAt(Date.now()); setErr('');
    } catch (e) {
      setErr(e?.message || 'Could not load');
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    /* Pause on a hidden tab, and refresh the moment it comes back — otherwise
       the first thing you see after switching back is a minute-old number. */
    const onVisibility = () => {
      setPaused(document.hidden);
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(poll); clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  if (!d && err) return <p className="text-red-300 text-sm">{err}</p>;
  if (!d) return <PageLoader />;

  const age = fetchedAt == null ? null : now - fetchedAt;
  const stale = age != null && age > (d.staleAfterSeconds || 60) * 1000;

  const t = d.today;
  const cb = d.chargebacks;
  const rf = d.refunds;
  const fd = d.failedDeliveries;
  const ls = d.lowStock;
  const cu = d.customers;
  const ads = d.ads;

  const undelivered = fd.undeliveredPaidOrders + fd.openFailures;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h1 className="text-2xl text-white">Launch command center</h1>
        <div className="flex items-center gap-2 text-xs">
          {/* The age, not the word "live". */}
          <span className={stale ? 'text-amber-300' : 'text-slate-400'}>
            <Dot size={14} className={`inline -ml-1 ${stale ? 'text-amber-300' : 'text-emerald-300'}`} />
            Updated {relAge(age)}
            {paused && ' · paused (tab hidden)'}
            {stale && ' · older than it should be'}
          </span>
          <button onClick={load} className="btn-ghost text-xs"><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        {d.bounds.tz} day, refreshed every {POLL_MS / 1000}s while this tab is open.
        {err && <span className="text-amber-300"> · last refresh failed: {err}</span>}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <Tile icon={Euro} label="Revenue today" value={eur(t.revenueCents)}
          sub={`${int(t.units)} unit(s) sold`} />
        {/* Null when nothing sold today has a known cost — never revenue-minus-nothing. */}
        <Tile icon={Percent} label="Profit today" value={eur(t.profitCents)}
          tone={t.profitCents != null && t.profitCents < 0 ? 'bad' : 'plain'}
          /* "over 100% of revenue" read as a 100% margin on the rendered page.
             The coverage share only needs saying when it is partial. */
          sub={t.profitCents == null
            ? 'no cost price on anything sold today'
            : `${t.marginPct ?? '—'}% margin${t.coverage.complete
              ? ' · every unit costed'
              : ` · counted on ${t.coverage.pct ?? 0}% of revenue`}`} />
        <Tile icon={ShoppingCart} label="Orders today" value={int(t.orders)}
          sub={`${int(cu.buyers)} buyer(s)`} />
        <Tile icon={ShieldAlert} label="Chargebacks" value={int(cb.today)}
          tone={cb.today > 0 ? 'bad' : cb.last30Days > 0 ? 'warn' : 'plain'}
          sub={`${int(cb.last30Days)} in 30 days · ${eur(cb.last30DaysCents)} taken back`} />
        <Tile icon={Undo2} label="Refunds" value={int(rf.refundedOrdersToday)}
          tone={rf.pendingRequests > 0 ? 'warn' : 'plain'}
          sub={`${eur(rf.refundedCentsToday)} today · ${int(rf.pendingRequests)} request(s) waiting on you`} />
        <Tile icon={PackageX} label="Failed deliveries" value={int(undelivered)}
          tone={undelivered > 0 ? 'bad' : 'plain'}
          /* The tile is the sum of two different failures, so the line under it
             names both — otherwise "3" is explained by a sentence about 2. */
          sub={undelivered === 0
            ? `nothing stuck · paid orders checked after ${fd.thresholdMinutes}m`
            : `${int(fd.openFailures)} failed at the supplier · ${int(fd.undeliveredPaidOrders)} paid and undelivered`
              + (fd.oldestUndeliveredMinutes != null ? ` (oldest ${fd.oldestUndeliveredMinutes}m)` : '')} />
        <Tile icon={Boxes} label="Low stock" value={int(ls.flagged)}
          tone={ls.outOfStock > 0 ? 'bad' : ls.critical > 0 ? 'warn' : 'plain'}
          sub={`${int(ls.outOfStock)} out · ${int(ls.critical)} critical · ${int(ls.low)} low of ${int(ls.activeProducts)}`
            + (ls.sourcedLive ? ` · ${int(ls.sourcedLive)} sourced live` : '')} />
        <Tile icon={UserPlus} label="New customers" value={int(cu.new)}
          sub="first order ever, today" />
        <Tile icon={Repeat} label="Returning customers" value={int(cu.returning)}
          sub={`${int(cu.new)} + ${int(cu.returning)} = ${int(cu.buyers)} buyer(s)`} />
        <Tile icon={Megaphone} label="Active ads" value={int(ads.activeCreatives)}
          sub={`${int(ads.visits)} visit(s) in ${ads.windowHours}h · ${int(ads.activeCampaigns)} campaign(s)`} />
      </div>

      {ls.products.length > 0 && (
        <div className="card p-4 mt-6">
          <p className="text-white mb-2 text-sm">Running out first</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
            {ls.products.map((p) => (
              <div key={p.productId} className="flex items-baseline justify-between gap-3">
                <span className="text-slate-300 truncate">{p.name}</span>
                <span className={p.codes === 0 ? 'text-red-300' : p.codes <= 5 ? 'text-amber-300' : 'text-slate-400'}>
                  {int(p.codes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ads.top.length > 0 && (
        <div className="card p-4 mt-4">
          <p className="text-white mb-1 text-sm">Adverts delivering traffic</p>
          {/* ad_visits is written only with marketing consent, so this is a
              floor rather than a census — said out loud so a zero is not read
              as "the ads are off". */}
          <p className="text-slate-400 text-xs mb-2">
            Counted from visits that consented to marketing cookies, so this is a floor, not a census.
          </p>
          <div className="space-y-1.5 text-sm">
            {ads.top.map((a) => (
              <div key={`${a.campaign}-${a.creative}-${a.network}`} className="flex items-baseline justify-between gap-3">
                <span className="text-slate-300 truncate">
                  {a.creative} <span className="text-slate-400">· {a.campaign}{a.network ? ` · ${a.network}` : ''}</span>
                </span>
                <span className="text-slate-300">{int(a.visits)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-slate-400 text-xs mt-4">
        Board built in {d.tookMs}ms. There is no push here — the page asks again every
        {' '}{POLL_MS / 1000}s and tells you how old the answer is.
      </p>
    </div>
  );
}
