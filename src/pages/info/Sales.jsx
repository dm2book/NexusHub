import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Filter } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';
import { iconFor } from '../../lib/sampleCatalog.js';

/**
 * Real sales feed — "Steam Wallet €20 sold · 4 minutes ago".
 *
 * Every row is a paid order that is still completed: not a refund, not a test
 * payment, not a free giveaway (the server decides that, see salesFeed()). No
 * name and no city; the product, how long ago, the country and the category.
 * When nothing has sold the page says so — there is no sample to fall back on,
 * by design. The filter options come from the same rows, so they only ever
 * offer a category or a country that actually sold.
 */
const LOCALE = { nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' };
const PERIODS = ['all', '1h', '24h', '7d', '30d'];
const REFRESH_MS = 60_000;

/** 🇳🇱 from "NL" — regional indicator letters, no image or lookup table. */
const flagOf = (code) => (code ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

export default function Sales() {
  usePageMeta();
  const { t, lang } = useI18n();
  const locale = LOCALE[lang] || 'en-GB';
  const [filters, setFilters] = useState({ category: '', country: '', period: 'all' });
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    const load = () => api.get(`/api/social/sales${qs ? `?${qs}` : ''}`)
      .then((r) => { if (live) setData(r); })
      .catch(() => { if (live) setData((d) => d || false); });
    load();
    // Refresh while someone is looking; a background tab asks nothing.
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => { live = false; clearInterval(id); };
  }, [filters]);

  const countryName = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames([locale], { type: 'region' });
      return (code) => { try { return dn.of(code) || code; } catch { return code; } };
    } catch { return (code) => code; }
  }, [locale]);

  const ago = useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return (s) => {
      if (s < 60) return rtf.format(-Math.max(1, s), 'second');
      if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
      if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
      return rtf.format(-Math.floor(s / 86400), 'day');
    };
  }, [locale]);

  const categoryLabel = (key) => {
    if (!key) return null;
    if (key === 'giftcard') return t('footer.giftcards', 'Giftcards');
    if (key === 'v-bucks') return 'V-Bucks';
    return key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };
  const periodLabel = (p) => ({
    all: t('sales.periodAll', 'All time'),
    '1h': t('sales.period1h', 'Last hour'),
    '24h': t('sales.period24h', 'Last 24 hours'),
    '7d': t('sales.period7d', 'Last 7 days'),
    '30d': t('sales.period30d', 'Last 30 days'),
  })[p];

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const filtered = filters.category || filters.country || filters.period !== 'all';
  const select = 'w-full rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3';

  return (
    <InfoShell eyebrow={t('sales.eyebrow', 'Live')} title={t('sales.title', 'Recent sales')}
      subtitle={t('sales.sub', 'Real orders only — paid and delivered. No names, no made-up notifications.')}>
      <div className="card p-4 mb-5" data-testid="sales-filters">
        <div className="flex items-center gap-2 text-slate-400 text-xs mb-3"><Filter size={13} /> {t('sales.filters', 'Filters')}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-400">{t('sales.category', 'Category')}
            <select value={filters.category} onChange={set('category')} className={`${select} mt-1`} name="category">
              <option value="">{t('sales.allCategories', 'All categories')}</option>
              {(data?.filters?.categories || []).map((c) => (
                <option key={c.key} value={c.key}>{categoryLabel(c.key)} ({c.count})</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">{t('sales.country', 'Country')}
            <select value={filters.country} onChange={set('country')} className={`${select} mt-1`} name="country">
              <option value="">{t('sales.allCountries', 'All countries')}</option>
              {(data?.filters?.countries || []).map((c) => (
                <option key={c.code} value={c.code}>{flagOf(c.code)} {countryName(c.code)} ({c.count})</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">{t('sales.period', 'Period')}
            <select value={filters.period} onChange={set('period')} className={`${select} mt-1`} name="period">
              {PERIODS.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
            </select>
          </label>
        </div>
      </div>

      {data === null ? (
        <p className="text-slate-500 text-center py-10">{t('sales.loading', 'Loading…')}</p>
      ) : data === false ? (
        <p className="text-slate-400 text-center py-10">{t('sales.error', 'The sales feed could not be loaded right now.')}</p>
      ) : data.sales.length === 0 ? (
        <div className="text-center py-12" data-testid="sales-empty">
          <ShoppingBag size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{filtered
            ? t('sales.emptyFiltered', 'No sales match these filters.')
            : t('sales.empty', 'No sales yet. This page only shows real orders, so it stays empty until the first one is delivered.')}</p>
          <Link to="/shop" className="btn-primary inline-flex mt-5">{t('sales.shop', 'Browse products')}</Link>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {data.sales.map((s) => {
              const icon = iconFor(s.category);
              return (
                <li key={s.id} className="card p-4 flex items-center gap-4" data-testid="sale-row">
                  {icon
                    ? <img src={icon} alt="" width="40" height="40" className="w-10 h-10 rounded-lg shrink-0" loading="lazy" />
                    : <span className="w-10 h-10 rounded-lg bg-white/5 grid place-items-center shrink-0"><ShoppingBag size={18} className="text-slate-500" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-semibold break-words">{t('sales.sold', '{product} sold', { product: s.product })}</div>
                    <div className="text-slate-400 text-sm">
                      <time dateTime={s.at} title={new Date(s.at).toLocaleString(locale)}>{ago(s.secondsAgo)}</time>
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs space-y-1">
                    {s.country && <div className="text-slate-300">{flagOf(s.country)} {countryName(s.country)}</div>}
                    {s.category && <div className="inline-block rounded-full bg-white/5 text-slate-400 px-2 py-0.5">{categoryLabel(s.category)}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-center text-slate-500 text-xs mt-6">
            {data.total === 1
              ? t('sales.countOne', '1 sale in this selection.')
              : t('sales.count', '{n} sales in this selection.', { n: data.total })}
          </p>
        </>
      )}
    </InfoShell>
  );
}
