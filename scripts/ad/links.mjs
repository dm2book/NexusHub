#!/usr/bin/env node
/**
 * The tagged link that goes under each advert.
 *
 * The ad workflow cuts eight variants of the same purchase. Without this they
 * all point at the same untagged address, and the admin report can tell you
 * that adverts brought forty visitors but not which of the eight did it — which
 * is the whole question.
 *
 *   node scripts/ad/links.mjs --sku=ROBUX-1000 --variants=all --network=tiktok
 *   node scripts/ad/links.mjs --sku=ROBUX-1000 --variant=B --campaign=launch-week
 *
 * Prints one line per variant, ready to paste into the destination field.
 *
 * ── The creative id ───────────────────────────────────────────────────────
 *
 * `{sku}-{variant}` — robux-1000-b. Derived rather than random, on purpose: the
 * id has to be readable in the report six weeks later by somebody who is looking
 * at the video file next to it, and a nanoid would mean keeping a mapping
 * somewhere that nobody would keep. It also means re-running this for the same
 * advert produces the same id, so a re-upload does not split its own numbers in
 * two.
 *
 * ── Where the parameters go ───────────────────────────────────────────────
 *
 * Two forms, because the two places these links live have different limits:
 *
 *   --style=utm    the full utm_* set. For an ad platform's destination field,
 *                  where nobody reads the URL and the standard names travel.
 *   --style=short  src/cid/crid. For a bio link or an on-screen address, where
 *                  the URL is typed by a human on a phone.
 *
 * Both land in the same columns — attributionService accepts either spelling.
 *
 * On a paid placement, prefer the platform's own macros over a fixed creative
 * id: TikTok substitutes __CID__ and Google substitutes {creative}, so the
 * report follows the platform's own splits instead of one id for the lot.
 * `--macros` prints that form. An unsubstituted macro is discarded server-side
 * rather than stored, so a misconfigured placement loses its attribution
 * instead of inventing a creative that outsells every real one.
 */
import { VARIANTS, variantById } from './variants.mjs';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const SKU = arg('sku') || arg('product');
if (!SKU) {
  console.error('Pass --sku=ROBUX-1000 (optionally --variants=all, --network=, --campaign=)');
  process.exit(1);
}

const BASE = (arg('base') || process.env.AD_BASE_URL || 'https://forgemarket.nl').replace(/\/+$/, '');
const NETWORK = (arg('network') || 'tiktok').toLowerCase();
const CAMPAIGN = arg('campaign') || 'launch';
const STYLE = arg('style') || 'utm';
const MACROS = flag('macros');
const slug = SKU.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* The medium is the honest one for the placement, not a flattering one.
   'organic' for a post you did not pay for, 'paid' for one you did — mixing
   them makes the paid conversion rate look like whatever the free traffic did. */
const MEDIUM = arg('medium') || (MACROS ? 'paid' : 'organic');

/** What each network substitutes at click time, when --macros is on. */
const MACRO = {
  tiktok: { campaignId: '__CAMPAIGN_ID__', adgroupId: '__AID__', creativeId: '__CID__', placement: '__PLACEMENT__' },
  youtube: { campaignId: '{campaignid}', adgroupId: '{adgroupid}', creativeId: '{creative}', placement: '{placement}' },
  google: { campaignId: '{campaignid}', adgroupId: '{adgroupid}', creativeId: '{creative}', placement: '{placement}' },
  meta: { campaignId: '{{campaign.id}}', adgroupId: '{{adset.id}}', creativeId: '{{ad.id}}', placement: '{{placement}}' },
};

/**
 * The product page this advert should land on.
 *
 * /product/:id resolves by product id and nothing else — getProduct() is a
 * lookup on the primary key — so a path built from the SKU would 404. Under a
 * paid placement that is the most expensive kind of bug there is: the click is
 * paid for, the viewer arrives at a missing page, and the report shows a
 * creative with visits and no sales, which reads as "bad advert".
 *
 * So the id is looked up, and a lookup that fails refuses to print a link
 * rather than printing one that does not work. `--path=` overrides for a
 * deliberate landing page.
 */
async function landingPath() {
  const override = arg('path');
  if (override) return override;
  if (!process.env.DATABASE_URL) {
    console.error('✖ No DATABASE_URL, so the product id cannot be looked up.');
    console.error('  /product/:id resolves by id, not by SKU — a link built from the SKU 404s.');
    console.error('  Set DATABASE_URL, or pass --path=/shop to land on the catalogue instead.\n');
    process.exit(1);
  }
  const { get } = await import('../../server/src/db/index.js');
  const row = await get(
    `SELECT id, name, active FROM products WHERE id = @v OR UPPER(sku) = UPPER(@v) LIMIT 1`,
    { v: SKU });
  if (!row) {
    console.error(`✖ No product "${SKU}" in this database — refusing to print a link to a 404.\n`);
    process.exit(1);
  }
  if (!row.active) {
    // Not fatal: an advert may be prepared before the product is switched on.
    console.error(`⚠ "${row.name}" is not active — the link will work, the product will not sell.\n`);
  }
  return `/product/${row.id}`;
}

function linkFor(variant, path) {
  const creative = `${slug}-${variant.id.toLowerCase()}`;
  const m = MACROS ? (MACRO[NETWORK] || null) : null;
  if (MACROS && !m) {
    console.error(`⚠ no macro set known for "${NETWORK}" — falling back to fixed ids.`);
  }

  const p = new URLSearchParams();
  if (STYLE === 'short') {
    p.set('src', NETWORK);
    p.set('cid', m?.campaignId || CAMPAIGN);
    p.set('crid', m?.creativeId || creative);
  } else {
    p.set('utm_source', NETWORK);
    p.set('utm_medium', MEDIUM);
    p.set('utm_campaign', CAMPAIGN);
    // utm_content carries the readable creative even when the id is a macro, so
    // a placement whose macro never expands still lands under a name you can
    // recognise instead of under "—".
    p.set('utm_content', creative);
    if (m) {
      p.set('campaign_id', m.campaignId);
      p.set('adgroup_id', m.adgroupId);
      p.set('creative_id', m.creativeId);
      p.set('placement', m.placement);
    } else {
      p.set('creative_id', creative);
    }
  }
  // Which product the advert is about. Read as an id or a SKU; unknown values
  // resolve to nothing rather than to a guess.
  p.set('product', SKU);

  /* Land on the product, not the homepage. The advert has just spent fifteen
     seconds on one product; a homepage costs the viewer a search they did not
     ask for, and every step between the click and the thing they wanted is a
     step some of them do not take. */
  return { creative, url: `${BASE}${path}?${p.toString().replace(/%7B/g, '{').replace(/%7D/g, '}')}` };
}

const want = arg('variants') === 'all' ? VARIANTS.map((v) => v.id)
  : (arg('variants') || arg('variant') || 'all').split(',').map((x) => x.trim()).filter(Boolean);
const list = want[0] === 'all' ? VARIANTS
  : want.map(variantById).filter(Boolean);

if (!list.length) { console.error(`No variant matched "${want.join(',')}".`); process.exit(1); }

const PATH = await landingPath();

console.log(`\n${SKU} · ${NETWORK} · campaign "${CAMPAIGN}"${MACROS ? ' · platform macros' : ''}`);
console.log(`landing ${PATH}\n`);
for (const v of list) {
  const { creative, url } = linkFor(v, PATH);
  console.log(`  ${v.id}  ${v.name}`);
  console.log(`     creative  ${creative}`);
  console.log(`     ${url}\n`);
}
console.log('  These ids are what the admin analytics report groups by.');
console.log('  Re-running this prints the same ids, so a re-upload does not split its own numbers.\n');
process.exit(0);
