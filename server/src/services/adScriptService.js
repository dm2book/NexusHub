/**
 * Viral ad scripts, generated per product from what the shop can prove.
 *
 * For one product: 10 hooks, 10 scripts and 10 CTAs, across eight hook kinds
 * (POV, Story, Comparison, Mistake, Problem, Before/After, Challenge, Myth),
 * each scored on hook strength, retention, scroll stop and conversion.
 *
 * ── THE ONLY RULE THAT MATTERS ────────────────────────────────────────────
 * Every line is built from a FACT and nothing else:
 *
 *   the product      its name, price, pack size, category and how it arrives
 *                    (a code by mail, or onto an account by username — Robux
 *                    is the second, and "code in je mail" would be false)
 *   real orders      paid, completed, not refunded, not a test payment, not a
 *                    giveaway — counted, and the last one dated
 *   real delivery    payment → delivered, from the order's own status history:
 *                    the time the buyer actually waited, not the time they
 *                    took to pay
 *   real prices      competitor prices observed through a marketplace API, with
 *                    the source and the date — and only when ours is lower
 *   the shop         refunds in writing on /refunds, guest checkout, the
 *                    redeem steps the delivery mail sends
 *
 * A template whose facts are missing is not produced. Then every line goes
 * through two gates: the claim layer every rendered advert already passes
 * (scripts/ad/claims.mjs — ratings, delivery times, "instant", price
 * comparisons, customer counts, each only with proof) and a gate on the
 * generic phrases a feed scrolls past: "shop now" never, "best prices" and
 * "instant delivery" only when the numbers say so. A product with too few
 * facts gets FEWER than ten, and says which facts are missing — it is not
 * padded with filler.
 *
 * ── THE SCORES ────────────────────────────────────────────────────────────
 * Predicted from how the script is built, each point with its reason — not
 * measured. Each script carries a tagged link (utm_content = the hook id), so
 * once it runs, Ad Intelligence measures it, and the measured landings and
 * purchases are shown beside the prediction.
 */
import { all, get } from '../db/index.js';
import { validateText, gatherEvidence } from '../../../scripts/ad/claims.mjs';
import { REDEEM } from '../../../src/lib/redeemRecipes.js';
import { deliveryField } from '../../../src/lib/deliveryInfo.js';
import { availableCount } from './codeStockService.js';
import { trustStats } from './socialProofService.js';
import { config } from '../config/env.js';

export const HOOK_TYPES = ['pov', 'story', 'comparison', 'mistake', 'problem', 'before-after', 'challenge', 'myth'];
export const TYPE_LABEL = {
  pov: 'POV', story: 'Story', comparison: 'Comparison', mistake: 'Mistake',
  problem: 'Problem', 'before-after': 'Before / After', challenge: 'Challenge', myth: 'Myth',
};
export const PER_PRODUCT = 10;

const DAY = 86_400_000;
const PAID = "o.status = 'completed'";

// ── Formatting, Dutch ──────────────────────────────────────────────────────
export const eur = (cents) => `€${(cents / 100).toFixed(2).replace('.', ',')}`;
const nl = (n) => Number(n).toLocaleString('nl-NL');
export function duration(seconds) {
  const s = Math.max(1, Math.round(seconds));
  if (s < 90) return `${s} sec`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} uur`;
}
function ago(iso, now) {
  const m = Math.max(1, Math.round((now - new Date(iso)) / 60_000));
  if (m < 60) return `${m} minuten geleden`;
  if (m < 48 * 60) return `${Math.round(m / 60)} uur geleden`;
  return `${Math.round(m / 1440)} dagen geleden`;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/* Countable packs only: "1.700 Robux" is 1,700 of something; "Steam Wallet €20" is not. */
const UNITS = /(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*(Robux|V-?Bucks|VP|Valorant Points|Riot Points|RP|Diamonds|Gems|Coins|UC|Genesis Crystals|Crystals|Primogems|Credits|Shards|Tokens)\b/i;
export function packOf(name) {
  const m = UNITS.exec(String(name || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/[.,\s]/g, ''));
  return n > 0 ? { n, unit: m[2].replace(/^v-?bucks$/i, 'V-Bucks') } : null;
}
const REGION = /\b(EU|NL|Europe|Global|Worldwide|UK|US|BE|DE)\b/;

// ── Facts ──────────────────────────────────────────────────────────────────

/**
 * Everything a line may be built from, for one product. Each field is null
 * when there is nothing real behind it.
 */
export async function factsFor(productId, { now = Date.now() } = {}) {
  const p = await get(`SELECT id, name, price, category, metadata, active FROM products WHERE id=@id`, { id: productId });
  if (!p) return null;
  let meta = {};
  try { meta = JSON.parse(p.metadata || '{}'); } catch { /* bad metadata is no metadata */ }
  const deliveryMode = meta.deliveryMode === 'manual' ? 'manual' : 'auto';
  const category = String(p.category || '').toLowerCase();
  const accountField = deliveryField(category, 'nl');          // "Roblox-gebruikersnaam", or null
  const recipe = REDEEM.nl[category] || null;                  // no generic fallback: a real place or nothing
  const pack = packOf(p.name);
  const price = Number(p.price) || 0;
  const stock = await availableCount(p.id).catch(() => 0);

  /* Real sales of this product: completed, paid with money (or store credit),
     not on a test key, not a refund-in-waiting. One row per order. */
  const sales = await all(
    `SELECT DISTINCT o.id, o.created_at,
            (SELECT MIN(h.created_at) FROM order_status_history h WHERE h.order_id=o.id AND h.to_status='payment_received') AS paid_at,
            (SELECT MIN(h.created_at) FROM order_status_history h WHERE h.order_id=o.id AND h.to_status='completed') AS done_at
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN social_events s ON s.order_id = o.id
      WHERE oi.product_id = @pid AND ${PAID} AND COALESCE(s.test, 0) = 0
        AND (o.total > 0 OR COALESCE((o.billing::jsonb ->> 'creditApplied')::numeric, 0) > 0)
      ORDER BY o.created_at DESC`, { pid: p.id }).catch(() => []);
  const timed = sales.filter((s) => s.paid_at && s.done_at)
    .map((s) => ({ at: s.done_at, seconds: Math.max(1, (new Date(s.done_at) - new Date(s.paid_at)) / 1000) }));
  const med = median(timed.map((t) => t.seconds));

  /* The lowest price a competitor was seen asking in the last 7 days. */
  const market = await get(
    `SELECT o.source_key, o.price_eur_cents AS cents, o.observed_at
       FROM market_candidates c JOIN market_observations o ON o.market_product_id = c.market_product_id
      WHERE c.forge_product_id = @pid AND o.price_eur_cents IS NOT NULL AND o.observed_at >= @since
        AND o.source_key <> 'official'
      ORDER BY o.price_eur_cents ASC LIMIT 1`,
    { pid: p.id, since: new Date(now - 7 * DAY).toISOString() }).catch(() => null);
  const SOURCE = { kinguin: 'Kinguin', g2a: 'G2A', eneba: 'Eneba', eldorado: 'Eldorado' };

  /* A bigger or smaller pack of the same thing, for a per-1.000 comparison. */
  let sibling = null;
  if (pack) {
    const sibs = await all(`SELECT id, name, price FROM products WHERE active = 1 AND category=@c AND id <> @id AND price > 0`,
      { c: p.category, id: p.id }).catch(() => []);
    const per = (row) => { const k = packOf(row.name); return k && k.unit === pack.unit && k.n !== pack.n ? { ...row, pack: k, per: Math.round((row.price / k.n) * 1000) } : null; };
    sibling = sibs.map(per).filter(Boolean).sort((a, b) => Math.abs(a.pack.n - pack.n) - Math.abs(b.pack.n - pack.n))[0] || null;
  }

  const stats = await trustStats().catch(() => ({}));
  const last7 = sales.filter((s) => now - new Date(s.created_at) <= 7 * DAY).length;
  return {
    product: { id: p.id, name: p.name, price, category, deliveryMode, active: !!p.active },
    priceText: eur(price),
    pack,
    amountText: pack ? `${nl(pack.n)} ${pack.unit}` : null,
    perThousand: pack && pack.n >= 100 ? eur(Math.round((price / pack.n) * 1000)) : null,
    /* The same numbers unformatted, for anything that animates or speaks them. */
    perThousandCents: pack && pack.n >= 100 ? Math.round((price / pack.n) * 1000) : null,
    region: (REGION.exec(p.name) || [])[1] || null,
    codeByMail: !accountField,
    accountField,
    redeemWhere: !accountField && recipe ? recipe.where : null,
    redeemSteps: !accountField && recipe ? recipe.steps.length : null,
    stockLeft: deliveryMode === 'auto' && stock > 0 && stock <= 6 ? stock : null,
    instant: deliveryMode === 'auto' && stock > 0,
    sold: { total: sales.length, last7, lastAt: sales[0]?.created_at || null, lastAgo: sales[0] ? ago(sales[0].created_at, now) : null },
    delivery: timed.length
      ? { n: timed.length, medianSeconds: Math.round(med), median: duration(med),
        latest: duration(timed[0].seconds), latestSeconds: Math.round(timed[0].seconds) }
      : { n: 0 },
    market: market && Number(market.cents) > price
      ? { source: SOURCE[market.source_key] || market.source_key, price: eur(Number(market.cents)),
        date: new Date(market.observed_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }), cheaper: true }
      : (market ? { cheaper: false, source: SOURCE[market.source_key] || market.source_key } : null),
    sibling: sibling ? { name: sibling.name, price: eur(sibling.price), amountText: `${nl(sibling.pack.n)} ${sibling.pack.unit}`,
      perThousand: eur(sibling.per), diff: eur(Math.abs(sibling.per - Math.round((price / pack.n) * 1000))),
      cheaperPerUnit: sibling.per < Math.round((price / pack.n) * 1000),
      priceCents: Number(sibling.price), n: sibling.pack.n, perCents: sibling.per, id: sibling.id } : null,
    stats: { rating: stats.rating ?? null, reviews: stats.reviews ?? 0, customers: stats.customers ?? 0, delivered: stats.delivered ?? 0 },
  };
}

// ── The gates ──────────────────────────────────────────────────────────────

/* The phrases a feed has learned to scroll past. Each is allowed only with the
   proof named — and "shop now" has none: it is not a claim, it is filler. */
export const GENERIC = [
  { id: 'shop-now', label: '"shop now"', re: /\b(shop now|buy now|order now|koop (het )?nu|bestel (het )?nu|nu (kopen|bestellen)|jetzt kaufen|achetez maintenant)\b/i,
    proven: () => false, why: 'a generic call to action — say what happens instead' },
  { id: 'best-price', label: '"best prices"', re: /\b(best(e)? (price|prices|prijs|prijzen)|scherpste prijs|laagste prijs|cheapest|goedkoopste|lowest price)\b/i,
    proven: (f) => !!f.market?.cheaper, why: 'only with a competitor price observed and higher' },
  { id: 'instant', label: '"instant delivery"', re: /\b(instant\w*|direct geleverd|meteen geleverd|onmiddellijk|binnen seconden|in seconds)\b/i,
    proven: (f) => f.instant && f.delivery.n >= 3 && f.delivery.medianSeconds <= 60,
    why: 'only for a product delivered automatically, with 3+ measured deliveries at a median under a minute' },
  { id: 'hype', label: 'hype', re: /\b(unbeatable|ongeëvenaard|don'?t miss|mis (het|dit) niet|limited time|beperkte tijd|100% (legit|safe|veilig)|trusted by|betrouwbaarste|guaranteed|gegarandeerd|(wij zijn|we zijn|we're|de) (nummer 1|#1)|beste (shop|webshop|winkel)|goedkoop!)\b|#1\s*(shop|webshop|store|in)\b/i,
    proven: () => false, why: 'a claim with nothing to check it against' },
];

/** The evidence the shared claim layer checks against, for this product. */
function claimEvidence(f) {
  return gatherEvidence({
    product: { instant: f.instant && f.delivery.n >= 3 && f.delivery.medianSeconds <= 60, deliveryLine: null },
    stats: { ...f.stats, avgDeliverySeconds: f.delivery.medianSeconds ?? null },
    measuredSeconds: f.delivery.latestSeconds ?? null,
    observations: f.market?.cheaper ? 1 : 0,
    lang: 'nl',
  });
}

/** A line may be used only if both gates pass it UNCHANGED. Returns null or the reasons it failed. */
export function gate(text, f) {
  const reasons = [];
  const claims = validateText(text, claimEvidence(f));
  if (!claims.ok) for (const x of claims.findings.filter((y) => !y.proven)) reasons.push(`${x.label}: needs ${x.proof}`);
  for (const g of GENERIC) if (g.re.test(text) && !g.proven(f)) reasons.push(`${g.label}: ${g.why}`);
  return reasons.length ? reasons : null;
}

// ── Templates ──────────────────────────────────────────────────────────────
/* `uses` names the facts behind the line — shown to the owner and used by the
   scores ("real" = from orders, deliveries or observed prices). */
const thing = (f) => f.amountText || f.product.name;
const unitOr = (f) => f.pack?.unit || f.product.name;

export const HOOKS = [
  // POV
  { id: 'pov-mail', type: 'pov', needs: (f) => f.codeByMail, uses: ['price', 'delivery method'],
    text: (f) => `POV: je betaalt ${f.priceText} en ${f.product.name} komt als code in je mail` },
  { id: 'pov-username', type: 'pov', needs: (f) => !!f.accountField, uses: ['delivery method'],
    text: (f) => `POV: ze vragen je ${f.accountField}. Niet je wachtwoord.` },
  { id: 'pov-sold', type: 'pov', needs: (f) => f.sold.last7 >= 2, uses: ['real orders'], real: true,
    text: (f) => `POV: ${f.sold.last7} mensen kochten deze week ${f.product.name} hier. Jij twijfelt nog.` },
  { id: 'pov-gift', type: 'pov', needs: (f) => f.codeByMail, uses: ['delivery method'],
    text: (f) => `POV: je geeft ${f.product.name} cadeau en hoeft niets te versturen. Het is een code.` },
  { id: 'pov-math', type: 'pov', needs: (f) => !!f.perThousand, uses: ['price', 'pack size'],
    text: (f) => `POV: je rekent eerst uit wat 1.000 ${f.pack.unit} kost`, reveal: (f) => `${f.perThousand}` },
  // Story
  { id: 'story-last', type: 'story', needs: (f) => !!f.sold.lastAgo && !!f.delivery.latest, uses: ['real orders', 'measured delivery'], real: true,
    text: (f) => `Iemand kocht ${f.sold.lastAgo} ${f.product.name}. Na ${f.delivery.latest} was het geleverd.` },
  { id: 'story-count', type: 'story', needs: (f) => f.sold.total >= 3 && f.delivery.n >= 3, uses: ['real orders', 'measured delivery'], real: true,
    text: (f) => `${f.sold.total} keer verkocht. Mediane levertijd: ${f.delivery.median}. Dit is ${f.product.name}.` },
  { id: 'story-stopwatch', type: 'story', needs: (f) => !!f.delivery.latest, uses: ['measured delivery'], real: true,
    text: (f) => `Ik zette een stopwatch aan toen ik ${f.product.name} betaalde.`, reveal: (f) => f.delivery.latest },
  // Comparison
  { id: 'cmp-market', type: 'comparison', needs: (f) => !!f.market?.cheaper, uses: ['price', 'observed competitor price'], real: true,
    text: (f) => `${f.product.name}: ${f.priceText} hier. ${f.market.source} vroeg ${f.market.price} op ${f.market.date}.` },
  { id: 'cmp-sizes', type: 'comparison', needs: (f) => !!f.sibling && !!f.perThousand, uses: ['price', 'pack size', 'catalogue'],
    text: (f) => `${f.amountText} voor ${f.priceText} of ${f.sibling.amountText} voor ${f.sibling.price}?`,
    reveal: (f) => `Per 1.000 scheelt het ${f.sibling.diff}` },
  { id: 'cmp-unit', type: 'comparison', needs: (f) => !!f.perThousand, uses: ['price', 'pack size'],
    text: (f) => `Wat kost 1.000 ${f.pack.unit} eigenlijk? Hier: ${f.perThousand}.` },
  // Mistake
  { id: 'mistake-password', type: 'mistake', needs: () => true, uses: ['delivery method'],
    text: (f) => (f.codeByMail
      ? `De fout bij ${unitOr(f)}: je wachtwoord aan een verkoper geven. Hier krijg je een code.`
      : `De fout bij ${unitOr(f)}: je wachtwoord geven. Wij vragen alleen je ${f.accountField}.`) },
  { id: 'mistake-region', type: 'mistake', needs: (f) => !!f.region, uses: ['product name'],
    text: (f) => `Check de regio voordat je ${f.product.name} koopt. Deze is ${f.region}.` },
  { id: 'mistake-account', type: 'mistake', needs: (f) => !!f.redeemWhere, uses: ['redeem steps'],
    text: (f) => `De fout: inwisselen op het verkeerde account. Check op ${f.redeemWhere} eerst wie er ingelogd is.` },
  // Problem
  { id: 'problem-guest', type: 'problem', needs: () => true, uses: ['guest checkout'],
    text: (f) => `Geen zin in nog een account? ${f.product.name} koop je zonder.` },
  { id: 'problem-refund', type: 'problem', needs: () => true, uses: ['refund policy'],
    text: () => 'Niet geleverd? Geld terug. Het staat op forgemarket.nl/refunds.' },
  { id: 'problem-stock', type: 'problem', needs: (f) => !!f.stockLeft, uses: ['stock'], real: true,
    text: (f) => `Nog ${f.stockLeft} van ${f.product.name} op voorraad.` },
  { id: 'problem-track', type: 'problem', needs: () => true, uses: ['order tracking'],
    text: (f) => `Waar blijft je ${unitOr(f)}? Je bestelling volg je op forgemarket.nl/track.` },
  // Before / After
  { id: 'ba-account', type: 'before-after', needs: (f) => !!f.accountField, uses: ['delivery method'],
    text: (f) => `Voor: je ${f.accountField} invullen. Na: ${thing(f)} op je account.` },
  { id: 'ba-amount', type: 'before-after', needs: (f) => !!f.pack, uses: ['price', 'pack size'],
    text: (f) => `Voor: 0 ${f.pack.unit}. Na: ${f.amountText}. Daartussen: ${f.priceText}.` },
  { id: 'ba-time', type: 'before-after', needs: (f) => !!f.delivery.latest, uses: ['measured delivery'], real: true,
    text: (f) => `Voor: betaald. Na ${f.delivery.latest}: ${f.codeByMail ? 'code in de mail' : 'op het account'}.` },
  { id: 'ba-redeem', type: 'before-after', needs: (f) => !!f.redeemWhere, uses: ['delivery method', 'redeem steps'],
    text: (f) => `Voor: een code in je mail. Na: ${thing(f)} via ${f.redeemWhere}.` },
  // Challenge
  { id: 'ch-guess', type: 'challenge', needs: (f) => !!f.pack, uses: ['price', 'pack size'],
    text: (f) => `Raad wat ${f.amountText} hier kost.`, reveal: (f) => f.priceText },
  { id: 'ch-stopwatch', type: 'challenge', needs: (f) => f.delivery.n >= 3, uses: ['measured delivery'], real: true,
    text: (f) => `Stopwatch-challenge: ${f.product.name}. Mediaan tot nu toe: ${f.delivery.median}.` },
  { id: 'ch-find', type: 'challenge', needs: (f) => !!f.market?.cheaper, uses: ['observed competitor price'], real: true,
    text: (f) => `Vind ${f.product.name} onder ${f.priceText}. ${f.market.source} zat op ${f.market.price}.` },
  { id: 'ch-redeem', type: 'challenge', needs: (f) => !!f.redeemSteps, uses: ['redeem steps'],
    text: (f) => `Challenge: ${f.product.name} inwisselen in ${f.redeemSteps} stappen.` },
  // Myth
  { id: 'myth-account', type: 'myth', needs: () => true, uses: ['guest checkout'],
    text: (f) => `Mythe: voor ${f.product.name} heb je een account nodig. Nee: afrekenen kan als gast.` },
  { id: 'myth-password', type: 'myth', needs: () => true, uses: ['delivery method'],
    text: (f) => (f.codeByMail
      ? `Mythe: voor ${unitOr(f)} moet je je wachtwoord delen. Je krijgt gewoon een code.`
      : `Mythe: voor ${unitOr(f)} moet je je wachtwoord delen. Alleen je ${f.accountField}.`) },
  { id: 'myth-refund', type: 'myth', needs: () => true, uses: ['refund policy'],
    text: () => 'Mythe: bij een code-shop krijg je nooit je geld terug. Ons beleid: forgemarket.nl/refunds.' },
];

export const CTAS = [
  { id: 'cta-search', needs: () => true, uses: ['product name'], dest: true, text: (f) => `Zoek "${f.product.name}" op forgemarket.nl` },
  { id: 'cta-bio', needs: () => true, uses: ['price'], dest: true, price: true, text: (f) => `${f.priceText} voor ${thing(f)}. Link in bio.` },
  { id: 'cta-mail', needs: (f) => f.codeByMail, uses: ['price', 'delivery method'], price: true, text: (f) => `Betaal ${f.priceText}, de code komt naar je mail.` },
  { id: 'cta-username', needs: (f) => !!f.accountField, uses: ['delivery method'], text: (f) => `Je ${f.accountField} invullen, betalen, klaar. forgemarket.nl` },
  { id: 'cta-refunds', needs: () => true, uses: ['refund policy'], dest: true, risk: true, text: () => 'Eerst lezen? forgemarket.nl/refunds — daarna beslis je.' },
  { id: 'cta-guest', needs: () => true, uses: ['guest checkout'], dest: true, risk: true, text: () => 'Afrekenen zonder account: forgemarket.nl' },
  { id: 'cta-math', needs: (f) => !!f.perThousand, uses: ['price', 'pack size'], price: true, text: (f) => `Reken het na: ${f.perThousand} per 1.000 ${f.pack.unit}.` },
  { id: 'cta-stock', needs: (f) => !!f.stockLeft, uses: ['stock'], real: true, dest: true, text: (f) => `Nog ${f.stockLeft} op voorraad — forgemarket.nl` },
  { id: 'cta-sales', needs: (f) => f.sold.total >= 1, uses: ['real orders'], real: true, dest: true, text: () => 'Kijk wat er vandaag echt verkocht is: forgemarket.nl/sales' },
  { id: 'cta-discord', needs: () => true, uses: ['support'], dest: true, text: () => 'Eerst een vraag? Stel hem in onze Discord: forgemarket.nl/discord' },
  { id: 'cta-compare', needs: (f) => !!f.market?.cheaper, uses: ['observed competitor price'], real: true, price: true,
    text: (f) => `Vergelijk zelf: ${f.market.source} ${f.market.price}, hier ${f.priceText}.` },
  { id: 'cta-redeem', needs: (f) => !!f.redeemWhere, uses: ['redeem steps'], dest: true, text: (f) => `Na betalen: code in je mail, inwisselen op ${f.redeemWhere}.` },
  { id: 'cta-account-steps', needs: (f) => !!f.accountField, uses: ['delivery method'], text: (f) => `Na betalen geef je je ${f.accountField} door — meer niet.` },
  { id: 'cta-how', needs: () => true, uses: ['how it works page'], dest: true, risk: true, text: () => 'Hoe het werkt, stap voor stap: forgemarket.nl/how-it-works' },
  { id: 'cta-shop', needs: () => true, uses: ['catalogue'], dest: true, text: (f) => `Andere bedragen ${f.pack ? `${f.pack.unit} ` : ''}vind je op forgemarket.nl/shop` },
  { id: 'cta-track', needs: () => true, uses: ['order tracking'], dest: true, risk: true, text: () => 'Je bestelling volgen kan op forgemarket.nl/track' },
];

// ── Scores ────────────────────────────────────────────────────────────────
const cap = (pts) => Math.max(0, Math.min(100, pts.reduce((a, [p]) => a + p, 0)));
const scored = (pts) => ({ score: cap(pts), why: pts.filter(([p]) => p).map(([p, w]) => `${p > 0 ? '+' : ''}${p} ${w}`) });
const words = (s) => String(s).trim().split(/\s+/).length;
const hasNumber = (s) => /\d/.test(s);
const INTERRUPT = /^(POV:|Mythe:|Fout|De fout|Stopwatch|Raad|Voor:|Vind|Check|Niet geleverd\?|Wat kost|Geen zin|Iemand|Ik zette|\d)/;
const OPEN_LOOP = new Set(['story', 'challenge', 'myth', 'before-after', 'comparison']);

export function hookStrength(h, f) {
  const t = h.text(f);
  return scored([
    [30, 'base'],
    [h.real ? 25 : 0, 'built on real orders, deliveries or observed prices'],
    [hasNumber(t) ? 15 : 0, 'a concrete number'],
    [t.includes(f.product.name) || (f.pack && t.includes(f.pack.unit)) ? 10 : 0, 'names what is sold'],
    [words(t) <= 12 ? 10 : (words(t) > 18 ? -10 : 0), words(t) <= 12 ? 'short enough to read in 2 seconds' : 'long for an opening'],
    [h.reveal ? 10 : 0, 'withholds an answer the video gives'],
  ]);
}
export function scrollStop(h, f) {
  const t = h.text(f);
  const first = t.split(/[.?!:]/)[0];
  return scored([
    [30, 'base'],
    [INTERRUPT.test(t) ? 20 : 0, 'opens with a pattern interrupt'],
    [/\d/.test(t.split(/\s+/).slice(0, 4).join(' ')) ? 20 : 0, 'a number in the first four words'],
    [words(first) <= 9 ? 15 : 0, 'first phrase of 9 words or fewer'],
    [/\?|\bNee\b|\bof\b/.test(t) ? 15 : 0, 'a question or a contradiction'],
  ]);
}
export function retentionScore(script, h) {
  const proofAt = script.beats.find((b) => b.kind === 'proof')?.from;
  const total = script.beats[script.beats.length - 1].to;
  return scored([
    [30, 'base'],
    [OPEN_LOOP.has(h.type) || h.reveal ? 25 : 0, 'an open loop the end of the video closes'],
    [proofAt != null && proofAt <= 6 ? 15 : 0, 'proof on screen by second 6'],
    [total >= 15 && total <= 25 ? 15 : 0, `${total}s — inside the 15–25s window`],
    [script.beats.some((b) => b.kind === 'how') ? 15 : 0, 'shows how it is used'],
  ]);
}
export function conversionScore(script, h, cta, f) {
  const copy = script.beats.map((b) => b.text).join(' ');
  return scored([
    [20, 'base'],
    [copy.includes(f.priceText) ? 20 : 0, 'the price is on screen'],
    [/refunds|zonder account|als gast|track/.test(copy) ? 15 : 0, 'takes a risk away'],
    [h.real || cta.real ? 20 : 0, 'real orders, deliveries or prices as proof'],
    [f.stockLeft && copy.includes(`Nog ${f.stockLeft}`) ? 10 : 0, 'real, low stock'],
    [cta.dest ? 15 : 0, 'the CTA names where to go'],
  ]);
}

// ── Scripts ───────────────────────────────────────────────────────────────
function proofBeat(h, f) {
  const k = h.id;
  if (k.startsWith('story') || k === 'pov-sold') return `Scherm: forgemarket.nl/sales met de echte order — ${f.sold.lastAgo || 'datum in beeld'}`;
  if (k === 'ba-time' || k.includes('stopwatch')) return `Schermopname: betaling → levering, klok in beeld (${f.delivery.latest || f.delivery.median})`;
  if (k === 'cmp-market' || k === 'ch-find') return `Screenshot ${f.market.source}: ${f.market.price} op ${f.market.date}, naast onze pagina met ${f.priceText}`;
  if (k === 'cmp-sizes') return `Rekensom in beeld: ${f.perThousand} tegen ${f.sibling.perThousand} per 1.000`;
  if (f.perThousand && (k.includes('math') || k === 'cmp-unit')) return `Rekensom in beeld: ${f.priceText} ÷ ${f.amountText} × 1.000 = ${f.perThousand}`;
  if (k.includes('refund')) return 'Scroll door forgemarket.nl/refunds — de zin over niet-geleverd in beeld';
  if (k.includes('guest') || k === 'myth-account') return 'Checkout zonder in te loggen, in één take';
  if (k.includes('password') || k === 'pov-username') {
    return f.codeByMail ? 'De bezorgmail met de code (code geblurd)' : `Het checkoutveld: alleen "${f.accountField}"`;
  }
  if (k === 'problem-stock') return `Productpagina: "Nog ${f.stockLeft} op voorraad"`;
  return `Productpagina: ${f.product.name} — ${f.priceText}`;
}

function buildScript(h, cta, f, i) {
  const beats = [
    { kind: 'hook', from: 0, to: 2, text: h.text(f) },
    { kind: 'proof', from: 2, to: 6, text: proofBeat(h, f) },
    { kind: 'what', from: 6, to: 11, text: `Wat je krijgt: ${thing(f)} — ${f.priceText}.` },
  ];
  if (h.reveal) beats.push({ kind: 'reveal', from: 11, to: 13, text: `Antwoord: ${h.reveal(f)}.` });
  const at = beats[beats.length - 1].to;
  beats.push(f.codeByMail
    ? { kind: 'how', from: at, to: at + 4, text: f.redeemWhere ? `Code in je mail, inwisselen op ${f.redeemWhere}.` : 'De code komt in je mail.' }
    : { kind: 'how', from: at, to: at + 4, text: `Je vult je ${f.accountField} in, nooit je wachtwoord.` });
  const risk = h.id.includes('refund') ? 'Afrekenen kan zonder account.' : 'Niet geleverd? Geld terug — forgemarket.nl/refunds.';
  beats.push({ kind: 'risk', from: at + 4, to: at + 7, text: risk });
  beats.push({ kind: 'cta', from: at + 7, to: at + 10, text: cta.text(f) });
  return {
    id: `script-${i + 1}`, hookId: h.id, ctaId: cta.id, beats,
    link: `${(config.appUrl || 'https://www.forgemarket.nl').replace(/\/$/, '')}/product/${f.product.id}?utm_source=tiktok&utm_campaign=ad-scripts&utm_content=${h.id}`,
  };
}

/** Pick `n` from scored candidates, spreading over kinds before repeating one. */
function diverse(cands, n, kindOf) {
  const byKind = new Map();
  for (const c of [...cands].sort((a, b) => b.rank - a.rank)) {
    const k = kindOf(c);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(c);
  }
  const out = [];
  while (out.length < n && [...byKind.values()].some((l) => l.length)) {
    const round = [...byKind.values()].filter((l) => l.length).map((l) => l.shift()).sort((a, b) => b.rank - a.rank);
    out.push(...round.slice(0, n - out.length));
  }
  return out;
}

/** Measured results of hooks already running, matched on utm_content. */
async function measured(hookIds) {
  const rows = await all(
    `SELECT v.content AS hook, COUNT(DISTINCT v.id) AS visits, COUNT(DISTINCT o.id) AS purchases
       FROM ad_visits v LEFT JOIN orders o ON o.ad_visit_id = v.id
        AND o.status IN ('payment_received','processing','awaiting_fulfillment','completed')
      WHERE v.campaign = 'ad-scripts' AND v.content = ANY(@ids) GROUP BY v.content`, { ids: hookIds }).catch(() => []);
  return new Map(rows.map((r) => [r.hook, { visits: Number(r.visits), purchases: Number(r.purchases) }]));
}

export async function generateAdScripts(productId, { now = Date.now() } = {}) {
  const f = await factsFor(productId, { now });
  if (!f) return null;
  const refused = [];
  const missing = new Set();

  const ok = (kind, item) => {
    if (!item.needs(f)) { for (const u of item.uses) missing.add(u); return false; }
    const lines = [item.text(f), ...(item.reveal ? [`Antwoord: ${item.reveal(f)}.`] : [])];
    for (const line of lines) {
      const why = gate(line, f);
      if (why) { refused.push({ kind, id: item.id, text: line, why }); return false; }
    }
    return true;
  };

  const hooks = HOOKS.filter((h) => ok('hook', h)).map((h) => {
    const hs = hookStrength(h, f); const ss = scrollStop(h, f);
    return { h, hs, ss, rank: hs.score + ss.score };
  });
  const ctas = CTAS.filter((c) => ok('cta', c)).map((c) => ({ c, rank: (c.real ? 30 : 0) + (c.dest ? 20 : 0) + (c.price ? 15 : 0) + (c.risk ? 10 : 0) }));

  const pickedHooks = diverse(hooks, PER_PRODUCT, (x) => x.h.type);
  const pickedCtas = diverse(ctas, PER_PRODUCT, (x) => x.c.id);
  const results = await measured(pickedHooks.map((x) => x.h.id));

  const scripts = pickedHooks.map((x, i) => {
    const cta = pickedCtas[i % Math.max(1, pickedCtas.length)]?.c || CTAS[0];
    const s = buildScript(x.h, cta, f, i);
    // Every beat through the same gates; a beat that fails is cut, not softened.
    s.beats = s.beats.filter((b) => {
      const why = gate(b.text, f);
      if (why) refused.push({ kind: 'beat', id: `${s.id}:${b.kind}`, text: b.text, why });
      return !why;
    });
    const ret = retentionScore(s, x.h); const conv = conversionScore(s, x.h, cta, f);
    return {
      ...s, type: x.h.type, typeLabel: TYPE_LABEL[x.h.type], seconds: s.beats[s.beats.length - 1].to,
      scores: { hookStrength: x.hs.score, retention: ret.score, scrollStop: x.ss.score, conversion: conv.score },
      why: { hookStrength: x.hs.why, retention: ret.why, scrollStop: x.ss.why, conversion: conv.why },
      measured: results.get(x.h.id) || null,
    };
  }).sort((a, b) => Object.values(b.scores).reduce((p, q) => p + q, 0) - Object.values(a.scores).reduce((p, q) => p + q, 0));

  const short = PER_PRODUCT - pickedHooks.length;
  return {
    product: f.product,
    facts: {
      price: f.priceText, pack: f.amountText, perThousand: f.perThousand, delivery: f.codeByMail ? 'code by e-mail' : `onto the account (${f.accountField})`,
      redeemWhere: f.redeemWhere, stockLeft: f.stockLeft, region: f.region,
      sold: f.sold, deliveryMeasured: f.delivery, market: f.market, sibling: f.sibling ? { name: f.sibling.name, perThousand: f.sibling.perThousand } : null,
    },
    hooks: pickedHooks.map((x) => ({ id: x.h.id, type: x.h.type, typeLabel: TYPE_LABEL[x.h.type], text: x.h.text(f),
      uses: x.h.uses, real: !!x.h.real, scores: { hookStrength: x.hs.score, scrollStop: x.ss.score },
      why: { hookStrength: x.hs.why, scrollStop: x.ss.why } })),
    scripts,
    ctas: pickedCtas.map((x) => ({ id: x.c.id, text: x.c.text(f), uses: x.c.uses })),
    types: HOOK_TYPES.map((t) => ({ type: t, label: TYPE_LABEL[t], count: pickedHooks.filter((x) => x.h.type === t).length })),
    shortfall: short > 0
      ? `${short} fewer than ${PER_PRODUCT}: nothing true left to say without ${[...missing].join(', ')}`
      : null,
    refused,
    scoreNote: 'Predicted from how each script is built — not measured. Post with the script\'s link and Ad Intelligence measures it; measured landings and purchases appear here.',
  };
}

/** Products to choose from, with their real sales, best-selling first. */
export async function adScriptProducts() {
  return all(
    `SELECT p.id, p.name, p.price, p.category,
            (SELECT COUNT(DISTINCT o.id) FROM order_items oi JOIN orders o ON o.id = oi.order_id
               LEFT JOIN social_events s ON s.order_id = o.id
              WHERE oi.product_id = p.id AND ${PAID} AND COALESCE(s.test, 0) = 0
                AND (o.total > 0 OR COALESCE((o.billing::jsonb ->> 'creditApplied')::numeric, 0) > 0)) AS sold
       FROM products p WHERE p.active = 1 AND p.price > 0
      ORDER BY sold DESC, p.name LIMIT 500`).then((r) => r.map((x) => ({ ...x, sold: Number(x.sold) })));
}
