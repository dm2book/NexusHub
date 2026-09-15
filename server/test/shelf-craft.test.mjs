/**
 * The shelf: the product card, its button, and the rails they sit on.
 *
 * This card is drawn seventy-two times across the shop, which makes it the
 * most leveraged thing in the stylesheet — a millimetre here outweighs
 * anything in the hero. The rules below are the ones that were arrived at by
 * looking at a real rendered grid, and each is written as the failure it
 * prevents rather than as the CSS it expects.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const card = readFileSync(join(ROOT, 'src', 'components', 'store', 'LightProductCard.jsx'), 'utf8');
/* Comments stripped for the rules about what the card must NOT contain. This
   file explains why animate-pulse was removed, and that explanation must not
   be read as the thing coming back. */
const cardCode = card
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const home = readFileSync(join(ROOT, 'src', 'pages', 'HomeStore.jsx'), 'utf8');
const hook = readFileSync(join(ROOT, 'src', 'lib', 'useRailEdges.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = [...cssCode.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return m.length ? m.map((x) => x[1]).join(';\n') : null;
};

// ── 1. The wall of buttons ──────────────────────────────────────────────────
console.log('— Fifteen equal shouts is silence —');
{
  /* Every card carried the same filled violet slab, and on the homepage
     fifteen of them are on screen at once. The grid read as a wall of buttons
     with some artwork behind it, and the product — the thing worth looking at
     — was the quietest element on its own card. The button is quiet until you
     are pointing at its card, and then it lights. */
  const cta = rule('.fm-cta');
  ok('the card button is one shared class, not a style attribute on each one',
    !!cta && !/style=\{\{\s*backgroundImage/.test(cardCode), 'a card still carries an inline gradient');
  ok('…and the homepage rails use the same one',
    (home.match(/className="fm-cta/g) || []).length >= 2, 'a rail tile still rolls its own');

  /* The quiet state is the one inside the hover query. That order is the
     whole safety property: a device that cannot hover never applies it, so a
     phone gets the filled button and not a washed-out one it can never light. */
  const quiet = cssCode.match(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.fm-cta \{([^}]*)\}/);
  ok('filled is the DEFAULT and quiet is the exception', !!cta && /linear-gradient/.test(cta));
  ok('…so a touch screen never gets the quiet one', !!quiet, 'the quiet state is not inside a hover query');

  ok('pointing at the card lights that card’s button',
    /\.fm-pcard:hover \.fm-cta/.test(cssCode));
  ok('…and so does reaching it with a keyboard',
    /\.fm-pcard:focus-within \.fm-cta/.test(cssCode) || /\.fm-cta:focus-visible/.test(cssCode));
}

// ── 2. The card as an object ────────────────────────────────────────────────
console.log('\n— A card you can point at —');
{
  const pcard = rule('.fm-pcard');
  ok('the card is styled in one place', !!pcard);
  /* Two shadows: the tight one is contact, the wide one is height off the
     page. Only a real object has both, and a card with one was flat whether
     you were pointing at it or not. */
  const shadows = (pcard.match(/box-shadow:([^;]*)/) || ['', ''])[1];
  ok('it has both a contact shadow and a cast one',
    (shadows.match(/rgb/g) || []).length >= 2, shadows.trim().slice(0, 60));
  ok('the lift is for pointers only, not sticky on a tap',
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]{0,400}?\.fm-pcard:hover/.test(cssCode));
  ok('…and holds still for prefers-reduced-motion',
    /prefers-reduced-motion[\s\S]{0,400}?\.fm-pcard/.test(cssCode));
}

// ── 3. The badge that looked like it had not loaded ─────────────────────────
console.log('\n— Nothing on a card pretends to be loading —');
{
  /* animate-pulse fades a whole element in and out: it is the shape a skeleton
     loader makes while it waits for data. The one badge carrying a real fact
     about the shelf — how many are left — was the one that looked unfinished. */
  ok('no badge on the product card uses the skeleton-loader pulse',
    !/animate-pulse/.test(cardCode), 'animate-pulse is back on the card');
  ok('the stock badge still says how many are left',
    /card\.onlyLeft/.test(card) && /card\.lastOne/.test(card));
}

// ── 4. The rail that gave no sign it could scroll ───────────────────────────
console.log('\n— A shelf that says where it ends —');
{
  /* The rails hide their scrollbar, which left the fifth card cut clean
     through with nothing to suggest there was more. The fade is driven by
     where the rail actually is: zero on a side with nothing beyond it, so a
     rail whose cards all fit shows no fade and never pretends. */
  const rail = rule('.fm-rail');
  ok('the rail still hides its scrollbar', /scrollbar-width:\s*none/.test(rail || ''));
  ok('…and fades where its content runs off',
    /mask-image:[^;]*--fade-l/.test(rail || ''));
  ok('the fade is a measurement, not a decoration',
    /scrollLeft/.test(hook) && /scrollWidth - el\.clientWidth/.test(hook));
  ok('…answered again when the catalogue arrives or the window changes',
    /ResizeObserver/.test(hook) && /'resize'/.test(hook));
  ok('…and written at most once a frame', /requestAnimationFrame/.test(hook));

  /* A mask clips to the element's own box, so a card rising out of an
     unpadded rail loses its top edge. */
  ok('the rail leaves room for a card to lift into',
    /padding-block:\s*\d+px;\s*margin-block:\s*-\d+px/.test(rail || ''), rail?.trim().slice(0, 80));

  /* One hook per rail. A ref shared by three of them tracks one and lies
     about the other two. */
  ok('each rail owns its own edges', /function Rail\(/.test(home) && /useRailEdges\(\)/.test(home));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} shelf-craft: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
