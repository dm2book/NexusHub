/**
 * The ad platforms' own numbers — spend, impressions, clicks — into ad_spend.
 *
 * Until now every row was typed in by hand, so ROAS and CTR stayed blank for
 * every advert nobody had time to type up. Two ways in, same result:
 *
 *   CSV  — the export Meta Ads Manager or TikTok Ads Manager already gives you
 *          (Dutch or English column names). Always works, no approval needed.
 *   API  — Meta's Insights API and TikTok's reporting API, read-only, with a
 *          token the owner sets (META_ADS_TOKEN + META_AD_ACCOUNT_ID,
 *          TIKTOK_ADS_TOKEN + TIKTOK_ADVERTISER_ID). Pulled every six hours by
 *          maintenance; nothing happens without the keys.
 *
 * ── HOW A PLATFORM ROW FINDS ITS SALES ─────────────────────────────────────
 * ad_spend is keyed (day, network, campaign, creative) and the attribution
 * report groups visits by (network, utm_campaign, utm_content). They meet when
 * the advert's link carries the platform's own names, which both platforms fill
 * in themselves with these URL parameters (TRACKING below):
 *
 *   Meta:   utm_source={{site_source_name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
 *   TikTok: utm_source=tiktok&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__
 *
 * and the import stores exactly campaign name and ad name. Meta's source names
 * (fb, ig) are the networks facebook and instagram here, and the API pull is
 * split by publisher platform for the same reason — one Meta invoice, two
 * networks that reach different people.
 */
import { config } from '../config/env.js';
import { recordSpend } from './adPerformanceService.js';
import { all, get, run, nowIso } from '../db/index.js';

export const TRACKING = {
  meta: 'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}',
  tiktok: 'utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__',
};

const TIMEOUT_MS = 12_000;

/* ── CSV ──────────────────────────────────────────────────────────────── */

/** RFC 4180-ish: quotes, doubled quotes, commas or semicolons (Dutch Excel). */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** "1.234,56", "1,234.56", "€ 12,5", "12" → number; '' → null. */
export function parseNumber(v) {
  let s = String(v ?? '').replace(/[€$\s ]/g, '').replace(/[A-Z]{3}$/i, '');
  if (!s || s === '-' || s === '--') return null;
  /* Thousands only: "1.200" in a Dutch export is twelve hundred, not 1.2 —
     read as a decimal it made 24 clicks on 1 impression. Likewise "1,200". */
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-10-05", "05-10-2026", "10/05/2026" (US export), "5 okt. 2026"? → ISO day or null. */
export function parseDay(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(s);           // Dutch: day-month-year
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);               // US export: month/day/year
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

/* Column names as each platform exports them, English and Dutch. First match wins. */
const COLS = {
  day: [/^day$/i, /^dag$/i, /^date$/i, /^datum$/i, /^by day$/i, /^reporting starts$/i, /^begin rapportage$/i, /^stat time day$/i],
  campaign: [/^campaign name$/i, /^campagnenaam$/i, /^campaign$/i, /^campagne$/i],
  creative: [/^ad name$/i, /^advertentienaam$/i, /^ad$/i, /^advertentie$/i],
  platform: [/^platform$/i, /^publisher platform$/i],
  impressions: [/^impressions$/i, /^weergaven$/i, /^vertoningen$/i, /^impressies$/i],
  clicks: [/^link clicks$/i, /^linkklikken$/i, /^clicks \(destination\)$/i, /^clicks$/i, /^klikken$/i, /^klikken \(alle\)$/i, /^clicks \(all\)$/i],
  spend: [/^amount spent/i, /^besteed bedrag/i, /^uitgegeven bedrag/i, /^cost$/i, /^kosten$/i, /^spend$/i, /^total cost$/i],
};
const META_PLATFORM = { facebook: 'facebook', fb: 'facebook', instagram: 'instagram', ig: 'instagram',
  'audience network': 'facebook', messenger: 'facebook', threads: 'instagram' };

/**
 * Import a Meta or TikTok Ads Manager export. `network` says which platform it
 * came from ('meta' | 'tiktok'); a Meta export broken down by Platform is split
 * into facebook and instagram, one without that column is stored as `meta`.
 * Rows are summed per (day, network, campaign, ad) before writing, because an
 * export broken down by placement has several rows for one ad and day.
 */
export async function importCsv(text, { network } = {}) {
  if (!['meta', 'tiktok'].includes(network)) throw new Error('Say which platform the export is from: meta or tiktok');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no data rows');
  const head = rows[0].map((h) => h.trim());
  const col = {};
  for (const [k, pats] of Object.entries(COLS)) {
    for (const re of pats) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) { col[k] = i; break; } }
  }
  const missing = ['day', 'spend'].filter((k) => col[k] == null);
  if (missing.length) {
    throw new Error(`Columns not found: ${missing.join(', ')}. Export with a daily breakdown ("Day"/"Dag") and the amount spent. Found: ${head.slice(0, 12).join(' | ')}`);
  }
  const sums = new Map(); const skipped = [];
  rows.slice(1).forEach((r, i) => {
    const day = parseDay(r[col.day]);
    if (!day) { skipped.push({ line: i + 2, why: `no date in "${r[col.day] ?? ''}"` }); return; }
    const plat = col.platform != null ? META_PLATFORM[String(r[col.platform] || '').trim().toLowerCase()] : null;
    const net = network === 'tiktok' ? 'tiktok' : (plat || 'meta');
    const campaign = col.campaign != null ? String(r[col.campaign] || '').trim() || null : null;
    const creative = col.creative != null ? String(r[col.creative] || '').trim() || null : null;
    const k = [day, net, campaign, creative].join('\u0000');
    const cur = sums.get(k) || { day, network: net, campaign, creative, impressions: 0, clicks: 0, spend: 0, has: { i: false, c: false, s: false } };
    const imp = col.impressions != null ? parseNumber(r[col.impressions]) : null;
    const clk = col.clicks != null ? parseNumber(r[col.clicks]) : null;
    const sp = parseNumber(r[col.spend]);
    if (imp != null) { cur.impressions += imp; cur.has.i = true; }
    if (clk != null) { cur.clicks += clk; cur.has.c = true; }
    if (sp != null) { cur.spend += sp; cur.has.s = true; }
    sums.set(k, cur);
  });
  let written = 0;
  for (const x of sums.values()) {
    try {
      await recordSpend({ day: x.day, network: x.network, campaign: x.campaign, creative: x.creative,
        impressions: x.has.i ? Math.round(x.impressions) : null, clicks: x.has.c ? Math.round(x.clicks) : null,
        spendCents: x.has.s ? Math.round(x.spend * 100) : null, source: 'import', note: `${network} csv` });
      written++;
    } catch (e) { skipped.push({ line: null, why: `${x.day} ${x.creative || ''}: ${e.message}` }); }
  }
  return { rows: rows.length - 1, written, skipped: skipped.slice(0, 50), skippedCount: skipped.length };
}

/* ── API ──────────────────────────────────────────────────────────────── */

const isoDay = (d) => d.toISOString().slice(0, 10);
const range = (days) => ({ since: isoDay(new Date(Date.now() - days * 86_400_000)), until: isoDay(new Date()) });

export const metaConfigured = () => !!(config.adPlatforms.meta.token && config.adPlatforms.meta.accountId);
export const tiktokConfigured = () => !!(config.adPlatforms.tiktok.token && config.adPlatforms.tiktok.advertiserId);

/** Meta Insights, per ad per day per publisher platform (facebook / instagram). */
export async function syncMeta({ days = 7, deadline = Date.now() + 20_000, fetchImpl = fetch } = {}) {
  if (!metaConfigured()) return { skipped: 'not configured' };
  const { token, accountId } = config.adPlatforms.meta;
  const { since, until } = range(days);
  const params = new URLSearchParams({
    level: 'ad', time_increment: '1', breakdowns: 'publisher_platform', limit: '500',
    fields: 'campaign_name,ad_name,impressions,inline_link_clicks,spend,date_start',
    time_range: JSON.stringify({ since, until }), access_token: token,
  });
  let url = `https://graph.facebook.com/v21.0/act_${encodeURIComponent(accountId)}/insights?${params}`;
  let written = 0, pages = 0;
  while (url && Date.now() < deadline && pages < 20) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Meta: ${body?.error?.message || res.status}`);
    for (const r of body.data || []) {
      const net = META_PLATFORM[String(r.publisher_platform || '').toLowerCase()] || 'meta';
      await recordSpend({ day: r.date_start, network: net, campaign: r.campaign_name || null, creative: r.ad_name || null,
        impressions: r.impressions != null ? Number(r.impressions) : null,
        clicks: r.inline_link_clicks != null ? Number(r.inline_link_clicks) : null,
        spendCents: r.spend != null ? Math.round(Number(r.spend) * 100) : null, source: 'api', note: 'meta insights' })
        .then(() => { written++; }).catch(() => {});
    }
    url = body.paging?.next || null;
    pages++;
  }
  return { written, pages };
}

/** TikTok reporting API, per ad per day. */
export async function syncTikTok({ days = 7, deadline = Date.now() + 20_000, fetchImpl = fetch } = {}) {
  if (!tiktokConfigured()) return { skipped: 'not configured' };
  const { token, advertiserId } = config.adPlatforms.tiktok;
  const { since, until } = range(days);
  let page = 1, written = 0, total = 1;
  while (page <= total && Date.now() < deadline && page <= 20) {
    const q = new URLSearchParams({
      advertiser_id: advertiserId, report_type: 'BASIC', data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
      metrics: JSON.stringify(['campaign_name', 'ad_name', 'spend', 'impressions', 'clicks']),
      start_date: since, end_date: until, page: String(page), page_size: '1000',
    });
    const res = await fetchImpl(`https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${q}`,
      { headers: { 'Access-Token': token }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body.code != null && body.code !== 0)) throw new Error(`TikTok: ${body?.message || res.status}`);
    for (const r of body.data?.list || []) {
      const m = r.metrics || {}; const d = r.dimensions || {};
      await recordSpend({ day: String(d.stat_time_day || '').slice(0, 10), network: 'tiktok',
        campaign: m.campaign_name || null, creative: m.ad_name || null,
        impressions: m.impressions != null ? Number(m.impressions) : null,
        clicks: m.clicks != null ? Number(m.clicks) : null,
        spendCents: m.spend != null ? Math.round(Number(m.spend) * 100) : null, source: 'api', note: 'tiktok report' })
        .then(() => { written++; }).catch(() => {});
    }
    total = Number(body.data?.page_info?.total_page || 1);
    page++;
  }
  return { written, pages: page - 1 };
}

const STATUS_KEY = 'ad_spend_sync_last';

/** Both platforms, recorded so the admin page can say when it last worked. */
export async function syncAll({ days = 7, deadline = Date.now() + 20_000 } = {}) {
  const out = { at: nowIso() };
  for (const [name, fn] of [['meta', syncMeta], ['tiktok', syncTikTok]]) {
    try { out[name] = await fn({ days, deadline }); } catch (e) { out[name] = { error: String(e.message).slice(0, 200) }; }
  }
  await run(`INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`,
    { k: STATUS_KEY, v: JSON.stringify(out), at: out.at }).catch(() => {});
  return out;
}

/** For the page: what is configured, the last run, and spend rows that match no visits. */
export async function syncStatus({ days = 30 } = {}) {
  const last = await get(`SELECT value FROM kv WHERE key=@k`, { k: STATUS_KEY }).catch(() => null);
  const since = isoDay(new Date(Date.now() - days * 86_400_000));
  /* A spend row whose (network, campaign, creative) has no visit at all: its
     link does not carry the names (see TRACKING), so its sales cannot be
     counted against it. Listed so the owner can fix the link, not guess. */
  const unmatched = await all(
    `SELECT s.network, s.campaign, s.creative, SUM(s.spend_cents) AS spend_cents
       FROM ad_spend s
      WHERE s.day >= @since AND NOT EXISTS (
        SELECT 1 FROM ad_visits v
         WHERE v.network = s.network
           AND COALESCE(v.creative_id, v.content, '—') = COALESCE(s.creative, '—'))
      GROUP BY 1, 2, 3 ORDER BY 4 DESC NULLS LAST LIMIT 20`, { since }).catch(() => []);
  return {
    meta: { configured: metaConfigured() }, tiktok: { configured: tiktokConfigured() },
    last: last?.value ? JSON.parse(last.value) : null,
    tracking: TRACKING,
    unmatched: unmatched.map((r) => ({ network: r.network, campaign: r.campaign, creative: r.creative, spendCents: Number(r.spend_cents || 0) })),
  };
}
