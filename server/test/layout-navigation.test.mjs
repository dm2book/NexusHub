/**
 * You can always get back out.
 *
 * Both sidebars were stretched flex children with no height of their own, so
 * they grew to the height of the PAGE and scrolled away with it — and the
 * `overflow-y-auto` on the nav inside had no bounded height to scroll within,
 * so it did nothing at all.
 *
 * Measured in a browser on the analytics page before the fix: 3980px of content
 * in a 900px window put the "Storefront" link at y=3884. Below the fold at the
 * top of the page, and STILL out of view at the bottom of it — there was no way
 * back to the shop from the admin except the browser's back button. The header
 * went with it, which on a phone takes the only button that opens the menu.
 *
 * Asserted on the classes rather than in a browser because this suite has no
 * browser: what has to hold is that the aside is pinned, sized to the viewport,
 * and not stretched — `self-start` is the one people leave out, and a stretched
 * flex item cannot stick.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

/** The desktop `<aside>` — the one that is part of the page, not the drawer. */
const desktopAside = (src) => {
  const all = [...src.matchAll(/<aside className="([^"]+)"/g)].map((m) => m[1]);
  return all.find((c) => !/absolute/.test(c)) || '';
};

for (const [name, file] of [
  ['admin', 'src/layouts/AdminLayout.jsx'],
  ['account', 'src/layouts/AccountLayout.jsx'],
]) {
  console.log(`\n— The ${name} sidebar stays where you can reach it —`);
  const src = read(file);
  const aside = desktopAside(src).replace(/\s+/g, ' ');

  ok('there is a desktop sidebar', !!aside, file);
  ok('it is pinned to the top', /\bsticky\b/.test(aside) && /\btop-0\b/.test(aside), aside);
  ok('…exactly one viewport tall', /\bh-screen\b/.test(aside), aside);
  /* The one that gets left out. Without it the aside stretches to the flex
     container's height, which is the height of the page — and a stretched item
     cannot stick, so the other two classes do nothing. */
  ok('…and not stretched, or the other two do nothing',
    /\bself-start\b/.test(aside), aside);

  console.log(`— …and so does the ${name} header —`);
  const header = (src.match(/<header className="([\s\S]*?)"/) || [, ''])[1].replace(/\s+/g, ' ');
  ok('the header is pinned', /\bsticky\b/.test(header) && /\btop-0\b/.test(header), header);
  ok('…above the content it sits over', /\bz-\d+\b/.test(header), header);
  /* backdrop-blur alone is see-through: content scrolls under it and the title
     becomes unreadable over whatever happens to be passing. */
  ok('…and opaque enough to be read over content', /\bbg-[a-z-]+\/\d+/.test(header), header);

  console.log(`— The way out is in the part that does not scroll —`);
  /* The nav scrolls; the footer holding Storefront / Admin Console and Sign out
     must not, or the fix moves the problem rather than solving it. */
  ok('the nav scrolls on its own', /<nav className="[^"]*overflow-y-auto/.test(src));
  ok('…and the links out sit in a shrink-0 footer',
    /border-t border-white\/5[^"]*shrink-0|shrink-0[^"]*border-t/.test(src),
    'the footer must not shrink away');
  ok('there is a link out of this section',
    /Storefront|Admin Console/.test(src));
  ok('…and a way to sign out', /Sign out/.test(src));
}

console.log('\n— The page is not squeezed into a third of the screen —');
{
  /* Comments stripped first: the file explains the fix by quoting the class it
     removed, and a grep over the raw source fails on the explanation rather
     than on the code. Same trap as every other source-scanning assertion in
     this suite. */
  const shop = read('src/pages/account/ForgeShop.jsx')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  /* It was capped at max-w-3xl (768px) inside a layout that already allows
     max-w-6xl, so on a 1400px window the content sat in 770px and the right
     half of the screen was empty. */
  ok('the Forge Shop does not set its own narrower cap',
    !/max-w-3xl/.test(shop), 'max-w-3xl caps it at 768px inside a max-w-6xl layout');
  ok('…and its rewards use the width they are given',
    /xl:grid-cols-4/.test(shop), 'four across on a wide screen');
}

console.log('\n— Two readiness panels, two different lists —');
{
  const analytics = read('src/pages/admin/Analytics.jsx');
  /* They sat stacked, both red, both about "can this shop sell", counting
     different lists and disagreeing — 4 against 5 — with nothing saying why. */
  ok('the launch-day panel says it is the launch-day plan',
    /launch-day plan are wrong/.test(analytics));
  ok('…and the readiness panel says it is the full check',
    /Full readiness check/.test(analytics));
  ok('…so neither claims to be the other',
    !/thing\(s\) needed to serve a customer are wrong/.test(analytics));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} layout-navigation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
