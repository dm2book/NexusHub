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

console.log(`\n${fail === 0 ? '✅' : '❌'} footer-craft: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
