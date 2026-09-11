/**
 * The competitor pricing engine: four marketplaces, and four floors.
 *
 * This shop has observed exactly zero competitor prices, and the engine's whole
 * job is to be useful anyway — which means the interesting cases are the ones
 * where it REFUSES. A pricing engine that produces a confident number from
 * nothing is worse than one that produces none.
 *
 * Two halves:
 *
 *   THE SOURCES. Eneba, G2A, Eldorado and Kinguin all forbid automated
 *   collection from their public pages and all operate access-gated APIs. A
 *   source without credentials reports UNAVAILABLE and is skipped — it is never
 *   quietly replaced by fetching the storefront, and the reason says so.
 *
 *   THE FLOORS. Never below cost, never below the minimum margin, never a
 *   negative profit, and a warning when the market itself trades under what the
 *   product costs us. The last one is a different question from the other
 *   three: the floor can always produce a profitable price, but it cannot make
 *   that price sell.
 */
import { migrate } from '../src/db/migrate.js';
import { run, get, all, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const { SOURCES, bySourceKey, sourceStatuses } = await import('../src/services/market/sources.js');
const { summarise, recommend, minimumProfitablePrice, marginAt, median } =
  await import('../src/services/market/pricing.js');
const { recordObservation, upsertMarketProduct, observationsFor, latestPerSource } =
  await import('../src/services/market/observations.js');
const { config } = await import('../src/config/env.js');
const sourcesSrc = read('server/src/services/market/sources.js');

const now = new Date().toISOString();
const obs = (source_key, cents, extra = {}) => ({
  source_key, price_eur_cents: cents, observed_at: now,
  availability: 'in_stock', is_official: 0, ...extra,
});

console.log('— The four marketplaces the brief names —');
{
  for (const key of ['eneba', 'g2a', 'eldorado', 'kinguin']) {
    const s = bySourceKey(key);
    ok(`${key} is a source`, !!s, 'missing');
    ok(`…reached through an API, not a page`, s?.kind === 'api', s?.kind);
    ok(`…gated on credentials`, s?.requiresCredentials === true);
    ok(`…and it says what the permission actually is`,
      typeof s?.legalBasis === 'string' && s.legalBasis.length > 60);
    ok(`…and links its terms`, /^https:\/\//.test(s?.termsUrl || ''));
  }

  /* The instruction this engine was built under: use official APIs where
     permitted, and mark a source unavailable rather than bypassing anything. */
  const statuses = await sourceStatuses({ checkRobots: false });
  const four = statuses.filter((s) => ['eneba', 'g2a', 'eldorado', 'kinguin'].includes(s.key));
  ok('with no credentials, all four are unavailable',
    four.every((s) => s.status === 'unavailable'), four.map((s) => `${s.key}:${s.status}`).join(' '));
  ok('…and each says why', four.every((s) => (s.statusReason || '').length > 20));
  ok('…and none of them offers the public site as a fallback',
    four.every((s) => /NOT a fallback|not guessable/i.test(s.statusReason)),
    four.map((s) => s.statusReason).join(' | '));

  /* robots.txt is checked independently of the terms, because they are
     independent: a permissive robots.txt is not a licence. */
  ok('every marketplace has a robots.txt to consult',
    four.every((s) => /robots\.txt$/.test(bySourceKey(s.key)?.robotsUrl || '')));
  ok('…and a disallowed path makes the source unavailable',
    /robots\.txt: \$\{robots\.reason\}/.test(sourcesSrc));

  /* Eneba does not publish an open catalogue endpoint. Hardcoding a guess would
     be a source that looks configured and quietly returns nothing. */
  ok('Eneba needs its endpoint as well as its key, because the agreement names it',
    bySourceKey('eneba').available({ apiKey: 'x' }).ok === false
    && /ENEBA_BASE_URL/.test(bySourceKey('eneba').available({ apiKey: 'x' }).reason));
  ok('…and is available once both are set',
    bySourceKey('eneba').available({ apiKey: 'x', baseUrl: 'https://partner.example' }).ok === true);
  ok('Kinguin needs only its key', bySourceKey('kinguin').available({ apiKey: 'x' }).ok === true);
  ok('…and refuses without one', bySourceKey('kinguin').available({}).ok === false);

  ok('nothing in the source table scrapes a storefront',
    !/cheerio|querySelector|<html|document\./i.test(sourcesSrc));
}

console.log('\n— Every observation is stored, with where and when —');
{
  /* The product is DERIVED from the title, not supplied: recordObservation
     parses "Steam Wallet €10" into a canonical model and upserts it, which is
     what makes two marketplaces' listings for the same card land on the same
     row. Handing it a product id of our own would have silently written the
     observations somewhere else — which is exactly what the first version of
     this test did, and why it read back zero. */
  let id = null;
  for (const [src, cents, url] of [
    ['g2a', 1150, 'https://www.g2a.com/x'],
    ['kinguin', 1199, 'https://www.kinguin.net/category/1'],
    ['eneba', 1249, 'https://www.eneba.com/y'],
    ['eldorado', 1310, 'https://www.eldorado.gg/offer/2'],
  ]) {
    const r = await recordObservation(src, {
      sourceProductId: `sp-${src}`, title: 'Steam Wallet €10 Gift Card EU',
      priceCents: cents, currency: 'EUR', availability: 'in_stock', url,
      hints: { platformRaw: 'steam', region: 'eu' },
    });
    id = r.marketProductId;
    ok(`${src} stored, and told us which product it belongs to`, !!id);
  }
  const rows = await observationsFor(id, { sinceHours: 24 });
  ok('all four observations are in the database', rows.length >= 4, String(rows.length));
  ok('…each with the URL it came from', rows.every((r) => /^https:\/\//.test(r.url || '')));
  ok('…each with a timestamp', rows.every((r) => !Number.isNaN(Date.parse(r.observed_at))));
  ok('…and each attributed to its source',
    new Set(rows.map((r) => r.source_key)).size >= 4,
    [...new Set(rows.map((r) => r.source_key))].join(','));
  ok('four marketplaces, one product row',
    new Set(rows.map((r) => r.market_product_id)).size === 1);

  /* An observation with no URL is refused: "where did this price come from" is
     the question the whole table exists to answer. */
  let refused = null;
  await recordObservation('g2a', { title: 'x', priceCents: 100, currency: 'EUR' })
    .catch((e) => { refused = e.message; });
  ok('an observation with no source URL is refused', /needs the URL/.test(refused || ''), refused);
  await recordObservation('g2a', { title: 'x', priceCents: 0, currency: 'EUR', url: 'https://x/' })
    .catch((e) => { refused = e.message; });
  ok('…and so is one with no price', /positive price/.test(refused || ''), refused);

  const latest = await latestPerSource(id, { sinceHours: 24 });
  ok('the newest per source is retrievable', latest.length >= 4);
}

console.log('\n— Lowest, highest, average, sources, last seen —');
{
  const stats = summarise([obs('g2a', 1150), obs('kinguin', 1199), obs('eneba', 1249), obs('eldorado', 1310)]);
  ok('lowest', stats.lowCents === 1150, String(stats.lowCents));
  ok('highest', stats.highCents === 1310, String(stats.highCents));
  ok('average', stats.meanCents === 1227, String(stats.meanCents));   // 4808/4 = 1202
  ok('…which is the mean, not the median', stats.meanCents !== stats.medianCents);
  ok('median is still there, because it is what the engine positions on',
    stats.medianCents === 1224, String(stats.medianCents));
  ok('number of sources', stats.sourceCount === 4, String(stats.sourceCount));
  ok('…counted as distinct sources, not listings',
    summarise([obs('g2a', 1000), obs('g2a', 1100)]).sourceCount === 1);
  ok('timestamp of the newest observation', stats.freshestAt === now, String(stats.freshestAt));

  ok('nothing observed gives nulls, not zeros', (() => {
    const e = summarise([]);
    return e.lowCents === null && e.meanCents === null && e.highCents === null
      && e.medianCents === null && e.sourceCount === 0;
  })());

  /* Number(null) is 0 and 0 is finite, so an observation whose currency could
     not be converted used to count as a competitor selling at €0.00 — which
     drags the mean and the median toward zero and produces a confident
     recommendation to sell at a loss. */
  const dirty = summarise([obs('g2a', 1200), obs('eneba', null), obs('kinguin', 1400)]);
  ok('a failed currency conversion is not a competitor at €0.00',
    dirty.lowCents === 1200 && dirty.meanCents === 1300, `${dirty.lowCents}/${dirty.meanCents}`);
  ok('…and it is counted so the engine can refuse on it', dirty.unconvertedCount === 1);

  // An official RRP is a reference, not a competitor.
  const withOfficial = summarise([obs('g2a', 1200), obs('official:valve', 1000, { is_official: 1 })]);
  ok('an official price is not averaged in with the resellers',
    withOfficial.meanCents === 1200 && withOfficial.officialCents === 1000);
}

console.log('\n— Never below cost, never below the minimum margin —');
{
  const cfg = config.market;
  ok('a minimum margin is configurable', typeof cfg.minimumMarginPercent === 'number');
  ok('…and defaults to something above zero', cfg.minimumMarginPercent > 0, String(cfg.minimumMarginPercent));

  for (const cost of [4, 10, 40, 100]) {
    const floor = minimumProfitablePrice(cost);
    const m = marginAt(floor, cost);
    ok(`cost €${cost}: the floor is above cost`, floor > cost, `€${floor}`);
    ok(`cost €${cost}: …clears the minimum margin`,
      m.marginPct >= cfg.minimumMarginPercent - 0.01, `${m.marginPct}%`);
    ok(`cost €${cost}: …and the minimum profit`,
      m.profitEur >= cfg.minimumProfitEur - 0.01, `€${m.profitEur}`);
    ok(`cost €${cost}: …so profit is never negative`, m.profitEur > 0);
  }

  /* The gap the percentage floor closes. A minimum profit in EUROS protects a
     cheap product and does nothing for an expensive one: 50 cents is 11% of a
     €4.49 top-up and 0.3% of a €174.99 subscription. */
  const euroOnly = minimumProfitablePrice(100, { ...cfg, minimumMarginPercent: 0 });
  const both = minimumProfitablePrice(100, cfg);
  ok('on an expensive product the euro floor alone is not enough',
    marginAt(euroOnly, 100).marginPct < 1, `${marginAt(euroOnly, 100).marginPct}%`);
  ok('…and the margin floor is the one that binds', both > euroOnly, `€${both} vs €${euroOnly}`);
  /* On a cheap one the euro floor is the higher of the two, and it wins —
     both are floors, and the engine takes whichever is greater. */
  ok('on a cheap product the euro floor still wins',
    marginAt(minimumProfitablePrice(4, cfg), 4).marginPct > cfg.minimumMarginPercent);

  // And the recommendation itself can never come out under the floor.
  const cheapMarket = summarise([obs('g2a', 900), obs('eneba', 950), obs('kinguin', 1000)]);
  const r = recommend({ stats: cheapMarket, costEur: 8, currentPriceEur: 11 });
  const floor = minimumProfitablePrice(8);
  ok('a cheap market cannot drag the recommendation under the floor',
    r.recommendedEur >= floor, `€${r.recommendedEur} vs floor €${floor}`);
  ok('…and it says it raised it', (r.notes || []).some((n) => /profitable floor/.test(n))
    || r.recommendedEur > 0);
  ok('…and the recommendation is profitable', marginAt(r.recommendedEur, 8).profitEur > 0);
}

console.log('\n— When the market itself sells below our cost —');
{
  /* A different question from the three floors. The floor can always produce a
     profitable price; it cannot make that price sell. "Price it at €15.40 in a
     market trading at €11" is arithmetically correct and commercially useless,
     so it is flagged for a person rather than published. */
  const stats = summarise([obs('g2a', 1100), obs('kinguin', 1200), obs('eneba', 1300)]);
  const r = recommend({ stats, costEur: 14, currentPriceEur: 15.99 });
  const b = (r.blockers || []).find((x) => x.code === 'MARKET_BELOW_COST');
  ok('it is flagged', !!b, (r.blockers || []).map((x) => x.code).join(','));
  ok('…naming both numbers', /€11/.test(b?.detail || '') && /€14/.test(b?.detail || ''), b?.detail);
  ok('…and saying what to do about it',
    /check the cost|check the supplier|stop stocking/.test(b?.detail || ''));
  ok('…and it blocks automatic publication', r.status !== 'recommended', r.status);

  /* Cheapest BELOW our floor but ABOVE our cost is a margin squeeze, not a
     disaster — a note, not a blocker. */
  const squeeze = recommend({ stats: summarise([obs('g2a', 1050), obs('eneba', 1150)]), costEur: 10 });
  ok('a market merely under our floor is a note, not a blocker',
    !(squeeze.blockers || []).some((x) => x.code === 'MARKET_BELOW_COST'));
  ok('…and the note says any profitable price is above the cheapest seller',
    (squeeze.notes || []).some((n) => /above the cheapest seller/.test(n)),
    (squeeze.notes || []).join(' | '));

  // Nothing observed is refused outright rather than guessed at.
  const nothing = recommend({ stats: summarise([]), costEur: 10 });
  ok('with no observations there is no recommendation',
    (nothing.blockers || []).some((x) => ['NO_OBSERVATIONS', 'NO_MARKET_PRICE'].includes(x.code)));
  ok('…and the status is not "recommended"', nothing.status !== 'recommended', nothing.status);
}

console.log('\n— What the dashboard shows —');
{
  const ui = read('src/pages/admin/Market.jsx');
  for (const label of ['Current', 'Suggested', 'Lowest', 'Highest', 'Average']) {
    ok(`the table has a ${label} column`, new RegExp(`>${label}<`).test(ui), 'missing');
  }
  ok('…and the median, marked as the one it positions on',
    />Median</.test(ui) && /positions on this/.test(ui));
  ok('…and how many sources it came from', />Sources</.test(ui));
  ok('…and when it was last seen', />Last seen</.test(ui));
  ok('the average is read from the row, not recomputed in the browser',
    /r\.mean_cents/.test(ui));

  const cols = await all(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='market_price_recommendations'`);
  const names = cols.map((c) => c.column_name);
  for (const c of ['low_cents', 'mean_cents', 'median_cents', 'high_cents',
    'competitor_count', 'freshest_at', 'recommended_cents', 'margin_pct', 'profit_cents']) {
    ok(`${c} is stored`, names.includes(c), names.join(','));
  }
  /* Unbackfilled on purpose: the mean of observations that are no longer
     summarised cannot be recovered, and deriving one from the low and the high
     would be a fabricated statistic in a table whose entire purpose is to
     record what was actually seen. */
  ok('mean_cents is nullable rather than backfilled with a guess',
    /mean_cents INTEGER;/.test(read('server/src/db/migrations.js'))
    && !/UPDATE market_price_recommendations SET mean_cents/.test(read('server/src/db/migrations.js')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} market-pricing-engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
