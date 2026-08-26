/**
 * The honesty policy, enforced instead of remembered.
 *
 * "Instant delivery", "24/7 support" and empty statistics have each been removed
 * from this codebase more than once — they come back because nothing fails when
 * they do. index.html in particular sat wrong for months while every visible
 * page had been corrected, because nobody reads the file that only crawlers and
 * link previews see.
 *
 * These checks read the shipped source, so a claim reintroduced anywhere in the
 * storefront fails CI rather than reaching a buyer.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === 'node_modules' || e.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|html)$/.test(e)) out.push(p);
  }
  return out;
};

// Only buyer-facing surfaces. The admin may say "instant" about a setting, and
// a code comment explaining WHY a claim was removed must not trip its own rule.
const BUYER_FACING = [
  ...walk(join(ROOT, 'src', 'pages')).filter((p) => !p.includes('/admin/')),
  ...walk(join(ROOT, 'src', 'components')).filter((p) => !p.includes('/admin/')),
  join(ROOT, 'index.html'),
];

/** Strip comments so an explanation of a removed claim is not read as the claim. */
const codeOf = (file) => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

console.log('— Claims we cannot back —');
{
  // Each pattern is a promise this shop cannot keep: one person confirms every
  // payment by hand, and most orders are delivered by hand too.
  const BANNED = [
    [/24\s*\/\s*7/, '24/7 support'],
    [/instant(ly)?\s+(automated\s+)?deliver/i, 'instant delivery'],
    [/delivered\s+instantly/i, 'delivered instantly'],
    [/delivered\s+in\s+seconds/i, 'delivered in seconds'],
    [/automated\s+fulfil?lment/i, 'automated fulfilment'],
    [/multi-supplier\s+engine/i, 'multi-supplier engine'],
  ];
  const hits = [];
  for (const file of BUYER_FACING) {
    const code = codeOf(file);
    for (const [re, label] of BANNED) {
      if (re.test(code)) hits.push(`${file.replace(ROOT + '/', '')}: ${label}`);
    }
  }
  ok('no buyer-facing file promises what the shop cannot deliver', hits.length === 0, hits.join(' | '));
}

console.log('\n— The file only crawlers read —');
{
  // index.html is what Discord and Google show. It stayed wrong long after every
  // visible page was fixed, precisely because nobody looks at it.
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const meta = (name) => (html.match(new RegExp(`(?:name|property)="${name}" content="([^"]*)"`)) || [, ''])[1];
  const all = ['description', 'og:title', 'og:description', 'twitter:title', 'twitter:description'].map(meta).join(' ');
  ok('the link preview makes no claim about instant or automated delivery',
    !/instant|automated|24\s*\/\s*7|in seconds/i.test(all), all.slice(0, 160));
  ok('it still describes what is actually sold', /Robux|V-Bucks|gift card/i.test(all));
  ok('it states the real delivery arrangement',
    /by hand|automatically/i.test(all), all.slice(0, 160));
}

console.log('\n— Empty numbers are never dressed up —');
{
  const trust = codeOf(join(ROOT, 'src', 'pages', 'Trust.jsx'));
  const reviews = codeOf(join(ROOT, 'src', 'pages', 'info', 'Reviews.jsx'));

  // A hardcoded percentage used as a fallback for "we have no data" is the exact
  // shape of the bug that printed "0 Delivered · 100% Protected" on launch day.
  ok('the Trust Center never substitutes a literal for a missing stat',
    !/:\s*'(100%|24\/7|—)'/.test(trust), 'a literal fallback is back');
  ok('/reviews never substitutes a literal for a missing stat',
    !/:\s*'100%'/.test(reviews), 'a literal fallback is back');

  // Every stat tile has to be gated on the number existing.
  ok('Trust Center stats are each gated on real data',
    /stats\.delivered > 0/.test(trust)
    && /stats\.avgDeliverySeconds != null/.test(trust)
    && /stats\.successRate != null/.test(trust)
    && /stats\.reviews > 0/.test(trust));
  ok('the whole grid disappears when nothing is measurable',
    /if \(!cards\.length\) return null/.test(trust));
}

console.log('\n— Who is selling —');
{
  const identity = readFileSync(join(ROOT, 'src', 'components', 'store', 'SellerIdentity.jsx'), 'utf8');
  const legal = readFileSync(join(ROOT, 'src', 'lib', 'legalIdentity.js'), 'utf8');

  // A KvK number is the one field here that cannot be improvised: a buyer can
  // look a real one up in seconds. It must render only when genuinely set.
  ok('the KvK number renders only when it holds a real value', /LEGAL\.kvk\s*\n?\s*\?/.test(identity));
  ok('the VAT number renders only when set', /LEGAL\.vat &&|LEGAL\.vat \?/.test(identity));
  ok('an unregistered seller says so in words rather than showing a blank row',
    /seller\.notRegistered/.test(identity));
  ok('the identity fields ship empty, to be filled in — never invented',
    /kvk:\s*''/.test(legal) && /vat:\s*''/.test(legal));

  // It has to be reachable from where buyers actually look.
  const footer = readFileSync(join(ROOT, 'src', 'components', 'store', 'StoreFooter.jsx'), 'utf8');
  const about = readFileSync(join(ROOT, 'src', 'pages', 'info', 'About.jsx'), 'utf8');
  const trust = readFileSync(join(ROOT, 'src', 'pages', 'Trust.jsx'), 'utf8');
  ok('the footer names the seller', /SellerIdentity/.test(footer));
  ok('the About page names the seller', /SellerIdentity/.test(about));
  ok('the Trust Center names the seller', /SellerIdentity/.test(trust));
}

console.log('\n— An outage is not a catalogue —');
{
  /* Measured in production, during a real one: every /api/ call was returning
     500 because the database had hit its transfer quota, and the storefront
     showed a full shelf of products with working Buy buttons — because a failed
     fetch fell through to the built-in sample catalogue. The outage was
     invisible from the front page, and every price on it was fiction.

     A shop with nothing loaded and a shop that could not be reached are
     different things to say, and only one of them may show products. */
  const catchBodies = (src) => {
    const out = [];
    for (const m of src.matchAll(/\.catch\(/g)) {
      let i = m.index + m[0].length, depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      out.push(src.slice(m.index, i));
    }
    return out;
  };

  const CATALOGUE_READERS = [
    'src/pages/Shop.jsx',
    'src/pages/HomeStore.jsx',
    'src/pages/ProductDetail.jsx',
    'src/pages/Wishlist.jsx',
    'src/lib/useTrending.js',
    'src/components/store/CommandPalette.jsx',
  ];
  for (const f of CATALOGUE_READERS) {
    const bodies = catchBodies(codeOf(join(ROOT, f)));
    const invents = bodies.filter((b) => /SAMPLE_PRODUCTS|withFallback/.test(b)
      // …unless the handler has already returned for everything but a 404.
      && !/status !== 404\) \{ setUnavailable\(true\); return; \}/.test(b));
    ok(`${f.split('/').pop()} shows no products when the catalogue could not be loaded`,
      invents.length === 0, invents.join(' ').slice(0, 120));
  }

  /* The product page keeps a lookup into the showcase, but only behind a 404:
     an empty deployment shows sample tiles and clicking one has to land
     somewhere. The check above would have failed on it — which is how this
     was found — because inside a catch it is indistinguishable from the
     behaviour being removed. Gated on the status code, it is not: an outage
     never reaches it. */
  const pdp = codeOf(join(ROOT, 'src/pages/ProductDetail.jsx'));
  ok('a direct link to a sample product still resolves by id',
    /SAMPLE_PRODUCTS\.find\(\(p\) => p\.id === id\)/.test(pdp));
  ok('but only after the shop answered 404, never after it failed to answer',
    /status !== 404\) \{ setUnavailable\(true\); return; \}/.test(pdp));

  // And the visitor has to be told, in words, that this is our fault.
  const shop = codeOf(join(ROOT, 'src/pages/Shop.jsx'));
  const home = codeOf(join(ROOT, 'src/pages/HomeStore.jsx'));
  ok('the catalogue says so when it cannot be reached', /shop\.unavailable/.test(shop));
  ok('the homepage says so too', /shop\.unavailable/.test(home));
  ok('the product page says so too', /product\.unavailable/.test(pdp));
  ok('the notice offers a way to try again', /shop\.retry/.test(shop));

  // "0 products" during an outage is a claim about the catalogue, and the
  // catalogue is precisely what we failed to read.
  ok('no product count is printed while the catalogue is unreachable',
    /!unavailable && \(/.test(shop) && /unavailable \? '' :/.test(shop));

  const copy = readFileSync(join(ROOT, 'src', 'lib', 'i18n.jsx'), 'utf8');
  for (const key of ['shop.unavailable', 'shop.unavailableSub', 'shop.retry',
    'product.unavailable', 'product.unavailableSub']) {
    ok(`${key} is translated`, new RegExp(`'${key.replace('.', '\\.')}':`).test(copy));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
