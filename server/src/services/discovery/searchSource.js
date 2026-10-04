/**
 * Search results as evidence that a product EXISTS — through the Brave Search
 * API, with the owner's key.
 *
 * Google's own Custom Search JSON API takes no new customers and shuts on
 * 1 January 2027, and scraping a search engine's pages is against its terms;
 * Brave sells a search API for exactly this. Nothing here fetches a shop's
 * page: only the API's answer (titles, links, snippets) is read.
 *
 * What it gives: for each game the shop sells, which packs the web mentions —
 * "2,800 FC Points PS5", "€25 Google Play" — each recorded as a MENTION with
 * the page, the domain and the query. What it never gives: a price, stock or a
 * picture the shop may use. So a product known only from search results is
 * never added automatically, and needs mentions on at least TWO different
 * websites before it is even put up for review — one page saying "18,500 FC
 * Points" is a rumour, two are a pattern.
 */
import { all, run, nowIso } from '../../db/index.js';
import { newId } from '../../utils/ids.js';
import { GAMES, PLATFORMS, REGIONS, parseTitle } from '../market/normalize.js';
import { credentialsFor } from '../market/sources.js';

export const MIN_DOMAINS = 2;
const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+)`;
const UNIT_WORDS = {
  robux: String.raw`robux`, 'v-bucks': String.raw`v-?bucks`, points: String.raw`(?:fc\s*)?points?`,
  vp: String.raw`(?:vp|valorant\s*points?)`, 'cod-points': String.raw`(?:cp|cod\s*points?|call\s*of\s*duty\s*points?)`,
  coins: String.raw`(?:apex\s*)?coins?`, uc: String.raw`uc`, diamonds: String.raw`diamonds?`, gems: String.raw`gems?`,
  'genesis-crystals': String.raw`(?:genesis\s*)?crystals?`, rp: String.raw`(?:rp|riot\s*points?)`,
  pokecoins: String.raw`pok[eé]coins?`, minecoins: String.raw`minecoins?`,
};
const RANGE = { EUR: [1, 500], months: [1, 24], default: [10, 100_000] };
const toNum = (s) => Number(String(s).replace(/[.,](?=\d{3}\b)/g, ''));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/** Exactly one family named → that one; none or several → null. */
function onlyOne(table, text) {
  const hits = table.filter((e) => e.patterns.some((re) => re.test(text))).map((e) => e.key);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Every pack of `game` a piece of text names: [{ denomination, platform, region }].
 * A number counts only right next to the game's own unit ("2800 FC Points",
 * "€25"), so a year, a price or "FC 26" is not a pack.
 */
export function extractMentions(text, gameKey) {
  const def = GAMES.find((g) => g.key === gameKey);
  if (!def) return [];
  const t = strip(text);
  const found = new Set();
  if (def.unit === 'EUR') {
    for (const m of t.matchAll(new RegExp(String.raw`€\s?${NUM}(?![.,]\d)|\b${NUM}\s?(?:€|eur\b|euro)`, 'gi'))) found.add(toNum(m[1] || m[2]));
  } else if (def.unit === 'months') {
    for (const m of t.matchAll(/\b(\d{1,2})\s*(months?|maanden|maand|monate?|mois)\b/gi)) found.add(Number(m[1]));
    for (const m of t.matchAll(/\b(\d)\s*(years?|jaar|jahre?|ans?)\b/gi)) found.add(Number(m[1]) * 12);
  } else if (UNIT_WORDS[def.unit]) {
    const unit = UNIT_WORDS[def.unit];
    /* Not an edition: the 26 in "FC 26 Points" is the game's year. */
    for (const m of t.matchAll(new RegExp(String.raw`(?<!\b(?:fc|fifa)\s?)\b${NUM}\s*${unit}\b`, 'gi'))) found.add(toNum(m[1]));
    /* And the other way round, as listings often write it: "FC Points 18500". */
    for (const m of t.matchAll(new RegExp(String.raw`\b${unit}\s*[-–:]?\s*${NUM}\b(?!\s*(?:%|€|eur|\$))`, 'gi'))) found.add(toNum(m[1]));
  }
  const [lo, hi] = RANGE[def.unit] || RANGE.default;
  const bound = !def.defaultPlatform && def.unit !== 'EUR';
  const platform = onlyOne(PLATFORMS, t);
  const region = onlyOne(REGIONS, t);
  return [...found].filter((n) => Number.isFinite(n) && n >= lo && n <= hi).map((denomination) => ({
    denomination,
    /* A game sold per console with no single console named is "unknown" —
       never a guess at which one. */
    platform: platform || (bound ? 'unknown' : undefined),
    region: region || 'unknown',
  }));
}

/** The query for a game: its name and its currency, as people search it. */
export function queryFor(gameKey) {
  const def = GAMES.find((g) => g.key === gameKey);
  if (!def) return null;
  if (def.unit === 'EUR') return `${def.label} gift card`;
  if (def.unit === 'months') return `${def.label} subscription months`;
  const unit = { points: 'FC Points', vp: 'Valorant Points', 'cod-points': 'COD Points', coins: 'Apex Coins',
    'genesis-crystals': 'Genesis Crystals', rp: 'Riot Points', pokecoins: 'PokéCoins', 'v-bucks': 'V-Bucks' }[def.unit] || def.unit;
  return def.key === 'ea-fc' ? 'EA FC Points' : `${def.label} ${unit}`;
}

/** Brave's web search, through the given fetch (throttled by the caller). */
export async function braveSearch(query, { apiKey, fetchImpl = fetch, count = 20 } = {}) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey } });
  if (res.status === 429) throw new Error('Brave Search rate limit reached (429)');
  if (!res.ok) throw new Error(`Brave Search API HTTP ${res.status}`);
  const data = await res.json();
  return (data?.web?.results || []).map((r) => ({ title: strip(r.title), url: String(r.url || ''), description: strip(r.description) }));
}

/**
 * Search for each game label and record the packs the results name.
 * Returns { searched, mentions, skipped?, errors[] }.
 */
export async function collectMentions(labels, { fetchImpl = fetch, credentials = null } = {}) {
  const creds = credentials || await credentialsFor('brave');
  if (!creds?.apiKey) return { searched: 0, mentions: 0, skipped: 'no Brave Search API key', errors: [] };
  const { upsertMarketProduct } = await import('../market/observations.js');
  const out = { searched: 0, mentions: 0, errors: [] };
  for (const label of labels) {
    const def = GAMES.find((g) => g.label === label || g.key === label);
    const q = def && queryFor(def.key);
    if (!q) continue;
    let results = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      results = await braveSearch(q, { apiKey: creds.apiKey, fetchImpl });
      out.searched += 1;
    } catch (e) { out.errors.push(`${q}: ${e.message}`); continue; }
    for (const r of results) {
      let domain = '';
      try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch { continue; }
      if (!/^https:/.test(r.url) || /(^|\.)forgemarket\.nl$/.test(domain)) continue; // never our own pages as evidence
      if (!def.patterns.some((re) => re.test(r.title))) continue;                     // the game must be in the TITLE
      for (const m of extractMentions(`${r.title} ${r.description}`, def.key)) {
        const productType = def.unit === 'EUR' ? 'giftcard' : def.unit === 'months' ? 'subscription' : 'points';
        const model = parseTitle(`${def.label} ${m.denomination}`, { game: def.key, denomination: m.denomination, denomUnit: def.unit,
          productType, ...(m.platform ? { platform: m.platform } : {}), region: m.region });
        // eslint-disable-next-line no-await-in-loop
        const mp = await upsertMarketProduct(model);
        // eslint-disable-next-line no-await-in-loop
        const ins = await run(`INSERT INTO market_mentions (id, market_product_id, source_key, query, title, url, domain, seen_at)
                                VALUES (@id, @p, 'brave', @q, @t, @u, @d, @at)
                                ON CONFLICT (market_product_id, url) DO UPDATE SET seen_at = @at`,
        { id: newId('mkm'), p: mp.id, q, t: r.title.slice(0, 300), u: r.url.slice(0, 1000), d: domain, at: nowIso() });
        if (ins) out.mentions += 1;
      }
    }
  }
  return out;
}

/* Desk research is dated when it was done, and counts for 90 days — never
   re-stamped "today" to look fresh. Search results count for the normal week. */
export const RESEARCH_DAYS = 90;

/** The fresh mentions behind one market product: pages and distinct websites. */
export async function mentionsFor(marketProductId, { sinceHours = 7 * 24 } = {}) {
  const cut = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const researchCut = new Date(Date.now() - RESEARCH_DAYS * 86_400_000).toISOString();
  const rows = await all(`SELECT url, domain, title, seen_at, source_key FROM market_mentions WHERE market_product_id=@p
                           AND (seen_at >= @cut OR (source_key = 'research' AND seen_at >= @rcut))`,
    { p: marketProductId, cut, rcut: researchCut }).catch(() => []);
  return { pages: rows.length, domains: [...new Set(rows.map((r) => r.domain))], rows };
}

export const searchConfigured = async () => !!(await credentialsFor('brave'))?.apiKey;

/**
 * Load the desk research (researchedPacks.js) as mentions, once per research
 * version. Idempotent: the same page for the same product is one row, dated
 * when the research was done.
 */
export async function importResearch({ force = false } = {}) {
  const { RESEARCHED_PACKS, RESEARCHED_AT, RESEARCH_VERSION } = await import('./researchedPacks.js');
  const done = await all(`SELECT value FROM kv WHERE key='discovery.research.version'`).catch(() => []);
  if (!force && done[0]?.value === RESEARCH_VERSION) return { skipped: 'already imported', version: RESEARCH_VERSION };
  const { upsertMarketProduct } = await import('../market/observations.js');
  let mentions = 0;
  for (const pack of RESEARCHED_PACKS) {
    const def = GAMES.find((g) => g.key === pack.game);
    if (!def) continue;
    const productType = def.unit === 'EUR' ? 'giftcard' : def.unit === 'months' ? 'subscription' : 'points';
    for (const platform of pack.platforms || [undefined]) {
      for (const denomination of pack.amounts) {
        const model = parseTitle(`${def.label} ${denomination}`, { game: def.key, denomination, denomUnit: def.unit, productType,
          ...(platform ? { platform } : {}), region: pack.region });
        // eslint-disable-next-line no-await-in-loop
        const mp = await upsertMarketProduct(model);
        for (const url of pack.sources) {
          let domain = '';
          try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
          // eslint-disable-next-line no-await-in-loop
          await run(`INSERT INTO market_mentions (id, market_product_id, source_key, query, title, url, domain, seen_at)
                     VALUES (@id, @p, 'research', @q, @t, @u, @d, @at) ON CONFLICT (market_product_id, url) DO NOTHING`,
          { id: newId('mkm'), p: mp.id, q: `research ${RESEARCH_VERSION}`, t: `${def.label}: ${pack.amounts.join(', ')}`,
            u: url, d: domain, at: RESEARCHED_AT });
          mentions += 1;
        }
      }
    }
  }
  await run(`INSERT INTO kv (key, value, updated_at) VALUES ('discovery.research.version', @v, @at)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`, { v: RESEARCH_VERSION, at: nowIso() });
  return { mentions, version: RESEARCH_VERSION };
}
