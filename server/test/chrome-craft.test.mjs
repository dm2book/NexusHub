/**
 * The footer, which is on every page and was the worst-looking thing on all of
 * them.
 *
 * The defect was arithmetic, not taste. The grid declared FOUR columns and the
 * component put FIVE things in it — a brand block and four link lists — so
 * "Help & Legal" wrapped underneath the brand and three quarters of the footer
 * was empty white. Nothing failed, nothing warned; the fifth item simply went
 * to a second row with three empty cells beside it.
 *
 * That matters more here than it would elsewhere. This is the last thing a
 * hesitant buyer reads, it holds the refund policy and the terms — the pages
 * people reach for when something has gone wrong — and it is where a shopper
 * has been trained to look for who is actually selling to them.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const footer = readFileSync(join(ROOT, 'src', 'components', 'store', 'StoreFooter.jsx'), 'utf8');
/* TWO bars, not one. The homepage renders its own copy of this header, and
   fixing only the shared component left the shop's name truncated on the one
   page most visitors land on first — which is exactly how the two drifted far
   enough apart for the homepage to still carry a 2.34:1 contrast failure the
   shared bar had already fixed. Every rule below is asked of both. */
const BARS = [
  ['StoreNav', readFileSync(join(ROOT, 'src', 'components', 'store', 'StoreNav.jsx'), 'utf8')],
  ['HomeStore', readFileSync(join(ROOT, 'src', 'pages', 'HomeStore.jsx'), 'utf8')],
];
const code = footer
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— The grid has room for everything in it —');
{
  /* Counted, not eyeballed: the number of tracks the grid declares against the
     number of blocks the component renders into it. This is the check that
     would have caught the empty quarter, and it keeps working when somebody
     adds a sixth list. */
  const cols = (code.match(/lg:grid-cols-\[([^\]]+)\]/) || [])[1];
  ok('the desktop grid declares its tracks explicitly', !!cols, 'no lg:grid-cols-[…] found');
  const tracks = cols ? cols.split('_').length : 0;
  const lists = (code.match(/\{\s*title:\s*t\(/g) || []).length;
  ok(`${lists} link lists + 1 brand block fit in ${tracks} tracks`,
    tracks === lists + 1, `${lists + 1} blocks into ${tracks} tracks — one will wrap into an empty row`);

  /* The brand block holds a tagline, two contact routes and a heading; half a
     phone is not enough for it. */
  ok('the brand block spans the full width below lg',
    /col-span-2 lg:col-span-1/.test(code));
  /* Four one-up lists ran to roughly 1,800px of footer on a phone. Paired, the
     whole footer measures 1,052px. */
  ok('the link lists pair up on a phone rather than stacking one-up',
    /grid grid-cols-2 lg:grid-cols-\[/.test(code), 'the base grid is one column');
}

console.log('\n— It looks like the rest of the site —');
{
  /* Emoji render in the OS's own style and weight. Three of them in the one
     place a nervous buyer looks for proof of a human read as a different site
     from the one above them. */
  ok('no emoji stand in for icons', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(code),
    'an emoji is being used where the site uses lucide everywhere else');
  ok('…the icon set is the one used everywhere else',
    /from 'lucide-react'/.test(footer) && /<MessageCircle|<Mail|<Star/.test(code));
}

console.log('\n— Who is selling is not fine print —');
{
  /* A scam storefront's footer is the one place this cannot be copied, so it
     should not look like the thing the page would rather you skipped. */
  ok('the seller identity is still rendered', /<SellerIdentity/.test(code));
  /* Measured rather than guessed at: the heading and its icon sit between the
     panel's class list and the component, so the window has to clear them. A
     400-char window failed on a gap of 450 and reported a panel that is
     plainly there as missing. */
  ok('…in a panel of its own, across the footer',
    /rounded-2xl border[\s\S]{0,160}?bg-slate-50[\s\S]{0,700}?<SellerIdentity/.test(code),
    'the identity is loose in the markup again rather than in its own panel');
  ok('…under a heading that says what it is', /footer\.whoSells/.test(code));

  /* The chat launcher floats above the bottom bar and was sitting on top of
     "All systems operational" — the one line down there whose whole job is to
     be read. */
  ok('the bottom bar leaves room for the chat launcher', /lg:pe-24/.test(code));
}

console.log('\n— Nothing here is invented —');
{
  /* A strip of payment logos is the obvious thing to put in a footer and the
     wrong thing to put in THIS one: the methods come from Mollie per amount
     and per device (see MollieMethods.jsx), so a fixed row would promise
     iDEAL to someone over its ceiling and Bancontact to someone in Germany. */
  ok('no hard-coded payment logos', !/ideal|bancontact|applepay/i.test(code),
    'the footer is claiming payment methods the shop cannot know in advance');
  /* Both of these already render only when configured. */
  ok('the Trustpilot link still waits for a real profile', /trustpilot &&/.test(code));
  ok('…and the support address for a real mailbox', /SUPPORT_EMAIL &&/.test(code));
}

console.log('\n— The header does not eat its own name —');
{
  /* Measured at 1440: the row is 1400px, padding takes 64 and seven 24px gaps
     take 168, leaving 1168 — and the children came to exactly 1168. Full to
     the pixel. The wordmark is the designated give-way element, so it gave way
     by the two pixels it was short and the shop rendered its own name as
     "ForgeMar…" on every desktop width from 1280 to 1920.
     Shrinking IS right below xl, where the wordmark is hidden and the link is
     a lone icon — that is what keeps a 390px row from scrolling sideways. It
     is wrong at xl and up, where the thing that gives way is the shop's name. */
  for (const [who, src] of BARS) {
    /* Read off the wordmark rather than written out: the threshold moved once
       already (xl → 1400, after measuring that xl does not fit), and this
       check was pinned to the old spelling within the hour. What matters is
       that the brand stops shrinking at the SAME width the wordmark appears
       at — pin the relationship, not the number. */
    const shows = (src.match(/hidden (\S+):inline[^"]*">ForgeMarket</) || [])[1];
    ok(`${who}: the wordmark cannot be squeezed where it is visible`,
      !!shows && new RegExp(`aria-label="ForgeMarket"[^>]*${shows.replace(/[[\]]/g, '\\$&')}:shrink-0`).test(src),
      `the brand link shrinks at the width the wordmark appears (${shows || '?'})`);
    ok(`${who}: …and may still shrink below xl, where it is only an icon`,
      /aria-label="ForgeMarket"[^>]*min-w-0/.test(src));
    ok(`${who}: the row leaves the gap room this needed`, /xl:gap-5/.test(src),
      'the row is back to being full to the pixel');

    /* A breakpoint is a guess about how much room there is; these two were
       wrong in the same way and had to be measured, not chosen.
       · The wordmark appeared at xl (1280), where the row needs about 120 more
         pixels than 1280 leaves and the wordmark is 119 of them — so the nav
         gave up its last word instead, and "Suppor" showed at every width from
         1280 to 1920 in every language. The container caps at 1400, so from
         there the room is fixed and enough.
       · The desktop nav appeared at lg (1024) with six links and a search box
         in a row with space for five: the last link was cut by 34-40px.
       Below each threshold nothing is lost — the mark alone says the shop's
       name, and the menu button carries the same links in full. */
    ok(`${who}: the wordmark waits for a width that fits it whole`,
      /hidden min-\[1400px\]:inline[^"]*">ForgeMarket</.test(src)
      || /hidden min-\[1400px\]:inline[^"]*truncate">ForgeMarket</.test(src),
      'the wordmark is back on a breakpoint that does not fit it');
    ok(`${who}: the desktop nav waits for a width that fits it`,
      /hidden min-\[1152px\]:flex/.test(src), 'the nav appears at 1024 again');
    ok(`${who}: …and the menu button steps aside at the same width`,
      /min-\[1152px\]:hidden w-11/.test(src),
      'the two thresholds drifted, so there is a width with neither');
    /* On slate-100 the lighter grey measures 2.34:1, under the 4.5:1 small
       text needs. The shared bar fixed it; this copy had not followed. */
    ok(`${who}: the search box's own label is readable on its ground`,
      !/bg-slate-100[^"]*text-slate-400/.test(src),
      'slate-400 on slate-100 is 2.34:1');
  }

  /* The search box is a fixed width, so the label has to be written for the
     width rather than truncated into it: "Search for products..." does not fit
     in 190px, and "Rechercher un produit..." did not fit in 240 either. A
     placeholder chopped mid-word beside a magnifying glass reads as a broken
     box rather than a short one. */
  for (const [who, src] of BARS) {
    ok(`${who}: the search box has a label written for its narrow width`,
      /nav\.searchShort/.test(src) && /whitespace-nowrap min-\[\d+px\]:hidden/.test(src),
      'the short label is gone, or no longer hides at a measured width');
    ok(`${who}: …and the full one only where it fits`,
      /hidden min-\[\d+px\]:inline/.test(src));
  }
}

console.log('\n— Every label fits the box it is in —');
{
  /* The search box is 232px wide, which leaves 138 for the label once the
     icon, the ⌘K key and the padding are taken out. Measured in the browser
     with the real font — three rounds of "still clipped" came from writing a
     label and then finding out. Anything longer is truncated mid-word beside a
     magnifying glass, which reads as broken rather than short.
     The English default lives in the component; the other three are in the
     dictionaries with their measured width written beside them. */
  const LIMIT = 138;
  const WIDTHS = { 'Search products…': 121, 'Producten zoeken…': 132,
    'Produkte suchen…': 124, 'Trouver un produit…': 134 };
  for (const [label, px] of Object.entries(WIDTHS))
    ok(`"${label}" fits (${px} of ${LIMIT}px)`, px <= LIMIT);

  const dicts = ['src/lib/i18n.jsx', 'src/lib/i18n/de.js', 'src/lib/i18n/fr.js']
    .map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);
  for (const [f, src] of dicts) {
    const m = src.match(/^  'nav\.search': '([^']*)'/m);
    ok(`${f.split('/').pop()} still uses a label that was measured`,
      !!m && Object.prototype.hasOwnProperty.call(WIDTHS, m[1]),
      m ? `"${m[1]}" has no measured width — measure it against ${LIMIT}px first` : 'no nav.search');
  }
  for (const [who, src] of BARS)
    ok(`${who}: the English default is the measured one`,
      /'Search products…'/.test(src), 'the long English label is back');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} chrome-craft: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
