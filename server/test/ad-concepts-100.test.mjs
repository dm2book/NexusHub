/**
 * The TikTok concept engine: 100 concepts in seven formats, filled in from a
 * product's facts and gated like every other advert.
 *
 * What must hold:
 *   exactly 100, every format present, ids unique;
 *   each concept a shooting script — a hook, timed beats, a caption, a CTA;
 *   a product with every fact gets (nearly) all of them, all through the gate;
 *   a product with NO sales, NO measured deliveries, NO observed prices and NO
 *   second pack size gets no concept that would need one — no delivery time,
 *   no sales count, no competitor name, no per-1.000 comparison;
 *   creator formats say they are an ad (#advertentie);
 *   the forum-thread format speaks only as the shop's own account;
 *   no generic "shop now" anywhere.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { CONCEPTS, FORMATS, DISCLOSE } = await import('../src/services/ads/conceptLibrary.js');
const { generateConcepts, visibleStrings, shootingScript } = await import('../src/services/adConceptService.js');

const facts = (over = {}) => ({
  product: { id: 'prd_robux_1700', name: '1.700 Robux', price: 1999, category: 'robux', deliveryMode: 'auto', active: true },
  priceText: '€19,99', pack: { n: 1700, unit: 'Robux' }, amountText: '1.700 Robux', perThousand: '€11,76', perThousandCents: 1176,
  region: 'EU', codeByMail: false, accountField: 'Roblox-gebruikersnaam', redeemWhere: null, redeemSteps: null,
  stockLeft: 3, instant: false,
  sold: { total: 12, last7: 4, lastAt: new Date().toISOString(), lastAgo: '2 uur geleden' },
  delivery: { n: 5, medianSeconds: 3600, median: '1 uur', latest: '47 min', latestSeconds: 2820 },
  market: { source: 'Eneba', price: '€21,49', date: '3 okt', cheaper: true },
  sibling: { name: '4.500 Robux', price: '€49,99', amountText: '4.500 Robux', perThousand: '€11,11', diff: '€0,65', cheaperPerUnit: true },
  stats: { rating: null, reviews: 0, customers: 0, delivered: 0 }, ...over,
});

console.log('— The library —');
{
  ok('exactly 100 concepts', CONCEPTS.length === 100, `${CONCEPTS.length}`);
  ok('seven formats: UGC, Story, POV, Comparison, Meme, Reddit-style, TikTok native',
    ['ugc', 'story', 'pov', 'comparison', 'meme', 'reddit', 'native'].every((k) => FORMATS.includes(k)));
  for (const k of FORMATS) {
    const n = CONCEPTS.filter((c) => c.format === k).length;
    ok(`${k}: at least 12 concepts`, n >= 12, `${n}`);
  }
  ok('ids are unique', new Set(CONCEPTS.map((c) => c.id)).size === CONCEPTS.length);
  ok('every concept is a shooting script (hook, beats, caption, CTA, sound, angle)',
    CONCEPTS.every((c) => typeof c.hook === 'function' && typeof c.beats === 'function' && typeof c.caption === 'function'
      && typeof c.cta === 'function' && c.sound && c.angle));
}

console.log('\n— A product with every fact —');
{
  const out = await generateConcepts('x', { facts: facts() });
  /* Robux goes onto an account, so the code-by-mail concepts (gift, redeem
     steps, "it is a code") rightly skip it. */
  ok('most of the 100 are produced', out.produced >= 85, `${out.produced}`);
  ok('…and what is skipped is only for a missing fact', out.skipped.every((s) => s.why.every((w) => /^needs /.test(w))),
    JSON.stringify(out.skipped).slice(0, 300));
  ok('every concept has a first frame and 3+ timed beats', out.concepts.every((c) => c.hook && c.beats.length >= 3 && c.beats.every((b) => /\d+–\d+s/.test(b.time))));
  const all = out.concepts.flatMap((c) => visibleStrings(c).map(([, s]) => s)).join('\n');
  ok('no "shop now" / "bestel nu" / "koop nu" anywhere', !/\b(shop now|bestel (het )?nu|koop (het )?nu|nu kopen|nu bestellen)\b/i.test(all));
  ok('no invented ratings or star counts', !/\b\d(?:[.,]\d)?\s*(?:\/|op)\s*5\b|sterren/i.test(all));
  ok('creator formats disclose the ad (#advertentie)',
    out.concepts.filter((c) => DISCLOSE.has(c.format)).every((c) => c.caption.includes('#advertentie')));
  const usernames = [...all.matchAll(/\bu\/[A-Za-z0-9_]+/g)].map((m) => m[0]);
  ok('the forum-thread style only ever speaks as the shop’s own account', usernames.every((u) => u === 'u/ForgeMarket_NL'), usernames.join(','));
  ok('no real subreddit is named (r/…)', !/\br\/[A-Za-z]/.test(all));
  ok('every concept carries its own tagged link', out.concepts.every((c) => c.link.includes(`utm_content=${encodeURIComponent(c.id)}`)));
  const md = shootingScript(out.concepts[0], out.product.name);
  ok('a concept exports as a shooting script with a beat table', /\| Tijd \| Beeld \| Tekst op beeld \|/.test(md) && md.includes(out.concepts[0].hook));
}

console.log('\n— A product with nothing proven yet —');
{
  const bare = facts({
    product: { id: 'prd_new', name: '1.700 Robux', price: 1999, category: 'robux', deliveryMode: 'auto', active: true },
    stockLeft: null, sold: { total: 0, last7: 0, lastAt: null, lastAgo: null }, delivery: { n: 0 }, market: null, sibling: null, region: null,
  });
  const out = await generateConcepts('x', { facts: bare });
  const all = out.concepts.flatMap((c) => visibleStrings(c).map(([, s]) => s)).join('\n');
  ok('still produces concepts (the format does not depend on sales)', out.produced >= 50, `${out.produced}`);
  ok('…but none names a delivery time', !/\b47 min\b|\b1 uur\b/.test(all));
  ok('…none a sales count', !/\b\d+×|\bkeer verkocht\b/.test(all));
  ok('…none a competitor', !/\b(Eneba|G2A|Kinguin|Eldorado)\b/.test(all));
  ok('…none a second pack size', !/4\.500 Robux/.test(all));
  ok('…and none a "nog N op voorraad"', !/nog \d+ op voorraad/.test(all));
  ok('the skipped list says which fact was missing', out.skipped.some((s) => s.why.some((w) => /measured|real completed sales|competitor/.test(w))));
}

console.log('\n— A gift card —');
{
  const gc = facts({
    product: { id: 'prd_steam20', name: 'Steam Wallet €20 EU', price: 2000, category: 'giftcard', deliveryMode: 'auto', active: true },
    pack: null, amountText: null, perThousand: null, perThousandCents: null, sibling: null, accountField: null, codeByMail: true,
    redeemWhere: 'Steam → Wallet → Code inwisselen', redeemSteps: 3,
  });
  const out = await generateConcepts('x', { facts: gc });
  const all = out.concepts.flatMap((c) => visibleStrings(c).map(([, s]) => s)).join('\n');
  ok('a gift card gets its own set', out.produced >= 60, `${out.produced}`);
  ok('…without per-1.000 maths (it is not a countable pack)', !/per 1\.000/.test(all));
  ok('…and never "username" talk for a code product', !/gebruikersnaam/.test(all));
}

console.log('\n— Wired into the admin —');
{
  const routes = readFileSync(join(ROOT, 'server/src/routes/admin/analytics.js'), 'utf8');
  ok('the admin API serves the concepts', /router\.get\('\/ad-concepts\/:productId'/.test(routes));
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  ok('the page has a route', /\/admin\/growth\/ad-concepts/.test(app));
  const page = readFileSync(join(ROOT, 'src/pages/admin/AdConcepts.jsx'), 'utf8');
  ok('the page filters by format and lists what was not possible', /concept-formats/.test(page) && /Not possible/.test(page));
}

console.log(`\n${fail ? '❌' : '✅'} ad-concepts-100: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
