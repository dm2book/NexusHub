/**
 * The pre-launch banner — the loudest thing on the storefront.
 *
 * It was a flat two-stop purple slab, which made the page carry THREE surfaces:
 * a saturated billboard, a white header, and the deep `.fm-stage` hero card
 * below it. The loudest element was also the only one not drawn in the shop's
 * own language, and the loudest thing inside it was four digits counting down
 * to the second — which at twelve days out is noise, and which made an opening
 * announcement read as a sale timer.
 *
 * So two things are tested here: the countdown shows what is worth showing, and
 * the banner is built out of the same material as the rest of the shop. The
 * accessibility and honesty properties it already had are pinned too, because
 * a redesign is the easiest place to lose them.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { visibleUnits, UNITS } = await import(join(ROOT, 'src/lib/launchUnits.js'));
const banner = read('src/components/store/LaunchBanner.jsx');
/* Comments stripped, the way honest-copy does it: this file's own docstring
   explains WHY the date is not hardcoded, by quoting a hardcoded date. */
const code = banner.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const css = read('src/index.css');
const at = (days, hours, minutes, seconds) => ({ days, hours, minutes, seconds });

console.log('— The countdown shows what is worth showing —');
{
  /* Twelve days out, a ticking seconds digit is the loudest thing in the
     banner and the least useful. */
  ok('twelve days out: days, hours, minutes',
    visibleUnits(at(12, 6, 41, 18)).join(',') === 'days,hours,minutes');
  ok('…and never four units at once',
    [at(12, 6, 41, 18), at(3, 0, 0, 0), at(0, 5, 2, 9)]
      .every((r) => visibleUnits(r).length <= 3));

  /* Under a day the hours lead; under an hour the seconds finally matter. */
  ok('under a day: hours, minutes, seconds',
    visibleUnits(at(0, 3, 41, 18)).join(',') === 'hours,minutes,seconds');
  ok('under an hour: minutes, seconds',
    visibleUnits(at(0, 0, 5, 18)).join(',') === 'minutes,seconds');
  ok('under a minute: seconds only',
    visibleUnits(at(0, 0, 0, 18)).join(',') === 'seconds');
  ok('under a second: still seconds, not nothing',
    visibleUnits(at(0, 0, 0, 0)).join(',') === 'seconds');

  ok('nothing left, nothing shown', visibleUnits(null).length === 0);
  ok('…and undefined is the same answer', visibleUnits(undefined).length === 0);
  ok('the largest unit always leads',
    visibleUnits(at(0, 3, 41, 18))[0] === 'hours'
    && visibleUnits(at(2, 0, 0, 0))[0] === 'days');
  ok('units are in descending order, always',
    [at(12, 6, 41, 18), at(0, 3, 0, 9), at(0, 0, 2, 9)].every((r) => {
      const idx = visibleUnits(r).map((u) => UNITS.indexOf(u));
      return idx.every((n, i) => i === 0 || n === idx[i - 1] + 1);
    }));

  /* The picker is a function rather than an expression inside the JSX, which
     is what makes any of the above testable at all. */
  ok('the banner uses it rather than its own copy', /visibleUnits\(remaining\)/.test(banner));
  /* Its own module with no imports, so a Node test can load it at all — the
     hook chain pulls React and a .jsx dictionary. */
  ok('…and it is exported from a module a test can actually import',
    /export function visibleUnits/.test(read('src/lib/launchUnits.js')));
}

console.log('\n— The date is the information, not the ticker —');
{
  /* The heading was "ForgeMarket launches {when}" in 1.25rem with the date
     inside the sentence, beside four counters set larger than it. */
  ok('the heading is the date itself', /id="launch-heading"[\s\S]{0,200}\{when\}/.test(banner));
  ok('…set larger than the counters',
    /text-\[1\.6rem\] sm:text-3xl/.test(banner));
  ok('…and still formatted in the reader’s own locale', /localeOf\(lang\)/.test(banner));
  ok('the verb moved to an eyebrow above it', /launch\.eyebrow/.test(banner));
  ok('…which is quiet', /text-\[11px\][\s\S]{0,80}text-white\/55/.test(banner));
}

console.log('\n— It is made of the same material as the rest of the shop —');
{
  ok('the flat purple slab is gone',
    !/linear-gradient\(135deg,#7c5cff,#a855f7\)/.test(banner));
  ok('…replaced by a surface with a name', /className="fm-launch/.test(banner));
  ok('the surface is layered like the hero stage, not a two-stop fill',
    (css.match(/\.fm-launch \{[\s\S]*?\}/)?.[0].match(/radial-gradient/g) || []).length >= 2);
  ok('…and it sheens like the hero stage does',
    /\.fm-launch::after[\s\S]{0,300}animation: fmSheen/.test(css));
  ok('…more slowly, so it sits under the hero rather than competing',
    (() => {
      const a = Number(/\.fm-launch::after[\s\S]{0,300}fmSheen (\d+)s/.exec(css)?.[1]);
      const b = Number(/\.fm-stage::after[\s\S]{0,300}fmSheen (\d+)s/.exec(css)?.[1]);
      return a > b;
    })());
  ok('it ends on a hairline rather than just stopping',
    /\.fm-launch::before[\s\S]{0,240}height: 1px/.test(css));

  /* One thing moving slowly instead of four digits ticking. */
  ok('the live signal is a single pulsing dot', /fm-launch-dot/.test(banner) && /fm-launch-dot/.test(css));
  ok('…and the clip-art rocket is gone', !/Rocket/.test(banner));

  /* A white input on a saturated slab was the loudest rectangle on the page
     and the least important thing in the banner. */
  ok('the email field is glass, not a white box',
    /bg-white\/\[0\.07\][\s\S]{0,200}ring-inset/.test(banner) && !/bg-white border border-white\/40/.test(banner));
  ok('…and it still shows focus', /focus:ring-2/.test(banner));
  ok('the button is the one saturated thing left',
    /linear-gradient\(135deg,#7c5cff,#d946ef\)/.test(banner));
}

console.log('\n— Motion is optional —');
{
  /* Both animations are decorative, and a banner that keeps sweeping for
     somebody who asked it not to is a banner that ignores them. */
  /* Sliced from the at-rule rather than matched with a lazy quantifier: a
     non-greedy `}` stops at the FIRST rule inside the block, so the second one
     was invisible to the assertion and the test said it was missing. */
  const i = css.indexOf('@media (prefers-reduced-motion: reduce)',
    css.indexOf('.fm-launch {') );
  const block = i < 0 ? '' : css.slice(i, i + 400);
  ok('the sheen stops when asked', /\.fm-launch::after \{ animation: none/.test(block));
  ok('…and so does the pulse', /\.fm-launch-dot::after \{ animation: none/.test(block));
  ok('…both inside the same reduced-motion block',
    block.indexOf('.fm-launch-dot::after') > block.indexOf('.fm-launch::after')
    && block.indexOf('}', block.indexOf('.fm-launch-dot::after')) > 0);
}

console.log('\n— What it already did right, still done right —');
{
  /* A screen reader announcing a new value every second is unusable; the
     useful information is "twelve days left". */
  ok('the ticking numbers are hidden from screen readers', /aria-hidden="true"/.test(banner));
  ok('…and a quiet live summary stands in for them',
    /className="sr-only" aria-live="polite"/.test(banner));
  ok('the email field keeps its label', /htmlFor="launch-email"[\s\S]{0,120}sr-only/.test(banner));
  ok('the section is still labelled by its heading', /aria-labelledby="launch-heading"/.test(banner));
  ok('errors are still announced', /role="alert"/.test(banner));

  /* The date comes from the configured launch moment, so moving the date does
     not leave a sentence lying. */
  ok('the date is rendered from the launch moment, never written out',
    /new Date\(launchAt\)/.test(code) && !/24 september|september 24/i.test(code));
  ok('the banner removes itself once the shop is open', /if \(!prelaunch\) return null/.test(banner));

  /* Stored against the subscription as proof of what was agreed to. */
  ok('the consent text is the sentence this visitor read',
    /const consentText = t\('launch\.consent'/.test(banner));
  ok('…and it is sent with the subscription', /consentText/.test(banner.split('api.post')[1] || ''));
  ok('a server failure does not blame the address',
    /err\?\.status >= 500 \|\| err\?\.status === 0/.test(banner));

  /* Nothing in a banner about an opening date may promise anything. */
  ok('it promises nothing the shop cannot do',
    !/24\s*\/\s*7|instant|guarantee|cheapest|best price/i.test(code));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} launch-banner: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
