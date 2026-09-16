/**
 * The menu on a phone.
 *
 * One screenshot from a real iPhone carried four defects at once, and every
 * one of them was a value that looked reasonable in the source:
 *
 *  · The language list opened off the left edge. It was `right-0`, correct for
 *    the switcher in the desktop header — which hangs left from a button on
 *    the right — and wrong for the same component sitting at the LEFT of the
 *    mobile drawer. Measured at 390px: the panel began at x = -90 and every
 *    one of the four languages started off-screen. You saw a sliver reading
 *    "…ands" and could not find out what the other three were, on the one
 *    control whose whole job is to show you what is on offer.
 *  · Given room to open downward instead, Français then landed behind the
 *    fixed tab bar: three of four, the same failure rotated ninety degrees.
 *  · The drawer's last row ran under that bar. On an iPhone SE the language
 *    button ended 33px below the top of it and elementFromPoint at the
 *    button's own centre returned the "Home" tab — not an overlap, an
 *    untappable control.
 *  · The page showed through underneath the menu, and the chat bubble floated
 *    on top of it.
 *
 * The browser measurements are in the commit. This pins the structure that
 * makes them true, because a suite with no browser can still say "the panel
 * is placed against the viewport rather than pinned to one side".
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/* Comments stripped, for the checks that are about what the code DOES. The
   number this file forbids is written out in the comment explaining why it is
   forbidden, and the first version of that assertion failed on its own
   reasoning. */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const nav = read('src/components/store/StoreNav.jsx');
const home = read('src/pages/HomeStore.jsx');
const drawer = read('src/components/store/MobileDrawer.jsx');
const css = read('src/index.css');

console.log('— The language list is placed against the screen, not one side —');
{
  const sw = nav.slice(nav.indexOf('export function LangSwitch'), nav.indexOf('/** Shared light storefront top-nav'));
  ok('the switcher exists where both drawers import it from', sw.length > 400);

  /* The defect was a fixed side. What replaces it has to be a measurement, and
     the only honest evidence of that in source is that it reads the viewport. */
  ok('it measures the viewport before opening',
    /window\.innerWidth/.test(sw) && /window\.innerHeight/.test(sw));
  ok('…and the button it hangs from', /getBoundingClientRect\(\)/.test(sw));
  ok('…and its own size, which is what decides whether it fits',
    /offsetWidth/.test(sw) && /offsetHeight/.test(sw));

  /* Before paint. In a plain useEffect the list is painted at the wrong place
     first and jumps, which on a menu that opens under your thumb reads as a
     misfire. */
  ok('it positions before the browser paints', /useLayoutEffect\(\(\) => \{[\s\S]{0,400}position/.test(sw));
  ok('…and again when the window changes size',
    /addEventListener\('resize'/.test(sw) && /removeEventListener\('resize'/.test(sw));

  /* Both axes. Getting the horizontal one right and leaving the vertical
     produced the second screenshot: all four on screen, the fourth behind the
     tab bar. */
  ok('the panel is given a left of its own', /left: place\.left/.test(sw));
  ok('…and a top, so it can open upwards when there is no room below',
    /top: place\.top/.test(sw));
  ok('…and a height cap, so a squeezed list scrolls instead of being cut off',
    /maxHeight: place\.maxHeight/.test(sw) && /overflow-y-auto/.test(sw));

  /* No `align` prop. The call site is what was wrong, so a prop is one more
     thing to get wrong the next time the button moves. */
  ok('the call sites are not asked which way it should open',
    !/align\s*[=:]/.test(sw), 'a side passed in is a side that can be passed in wrongly');
}

console.log('\n— Nothing ends underneath the tab bar —');
{
  /* The bar's height is a real number that three things need. It was written
     down once for the chat bubble; the menu did not know about it at all. */
  ok('the bar height is a token, defined once', /--fm-bottom-bar:\s*\d+px/.test(css));
  ok('…zeroed where there is no bar', /min-width:\s*1024px\)\s*\{\s*:root\s*\{\s*--fm-bottom-bar:\s*0px/.test(css));
  ok('the clearance rule is built from it',
    /\.fm-clears-tabbar\s*\{[^}]*var\(--fm-bottom-bar\)/.test(css));
  ok('…and respects the phone\'s own safe area',
    /\.fm-clears-tabbar\s*\{[^}]*safe-area-inset-bottom/.test(css));

  const sw = nav.slice(nav.indexOf('export function LangSwitch'), nav.indexOf('/** Shared light storefront top-nav'));
  ok('the language list reads the same token rather than repeating the number',
    /--fm-bottom-bar/.test(sw) && !/\b73\b/.test(codeOf(sw)),
    'a third copy of 73 is a third place to forget');
}

console.log('\n— The menu covers the page, and owns it while open —');
{
  ok('there is one drawer component', drawer.length > 800);
  ok('both menus use it',
    /<MobileDrawer/.test(nav) && /<MobileDrawer/.test(home));
  /* The old shape: a bare block that appeared inside the header and pushed
     nothing aside. Neither file may go back to it. */
  for (const [name, src] of [['StoreNav', nav], ['HomeStore', home]]) {
    ok(`${name} no longer renders a bare menu block`,
      !/lg:hidden border-t border-slate-200\/70 bg-white px-4 py-3/.test(src));
  }

  ok('it fills the space below the header rather than assuming a height',
    /innerHeight - .*getBoundingClientRect\(\)\.top/.test(drawer));
  ok('…re-measuring after the frame the lock lands in',
    /requestAnimationFrame\(measure\)/.test(drawer));
  ok('…and on rotation', /orientationchange/.test(drawer));

  ok('the page behind it cannot scroll', /body\.style\.overflow = 'hidden'/.test(drawer));
  ok('…and is given its scrolling back on close',
    /const prev = body\.style\.overflow/.test(drawer) && /body\.style\.overflow = prev/.test(drawer));
  ok('the menu scrolls on its own instead', /overflow-y-auto/.test(drawer) && /overscroll-contain/.test(drawer));
  ok('…and clears the tab bar', /fm-clears-tabbar/.test(drawer));

  ok('the chat bubble gets out of the way', /fm-menu-open/.test(drawer)
    && /body\.fm-menu-open \.fm-fab \{ display: none/.test(css));
  ok('…and comes back', /classList\.remove\('fm-menu-open'\)/.test(drawer));
}

console.log('\n— And it closes, so the lock is never left on —');
{
  /* A body lock that outlives the menu is worse than every defect above: the
     page simply stops scrolling and nothing explains why. */
  ok('the shop drawer closes when the route changes',
    /useEffect\(\(\) => \{ setOpen\(false\); \}, \[pathname\]\)/.test(nav));
  ok('the home drawer closes when a link in it is tapped',
    (home.match(/onClick=\{\(\) => setMenuOpen\(false\)\}/g) || []).length >= 2);
  ok('the lock is released by the effect that set it, not by a caller',
    /return \(\) => \{ body\.style\.overflow = prev;/.test(drawer));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} mobile-menu: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
