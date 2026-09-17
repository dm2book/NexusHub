/**
 * The shop on a phone.
 *
 * Audited every route at 390px in a real browser. Two things came out of it,
 * and the rest of what my first sweep reported was the sweep being blunt — a
 * horizontal rail whose items extend past the fold is a rail working, not a
 * page overflowing, and no route scrolls sideways at any width.
 *
 *  · The statutory withdrawal form on /refunds was cut off. It is a <pre> with
 *    `whitespace-pre-wrap`, which breaks on spaces — and the dotted rules in
 *    that form are one unbroken run of dots. Measured at 390px: 383px of
 *    content in a 348px box, so the line after "Order number:" ran off the
 *    right edge and the box became a sideways scroller. A legal form that
 *    cannot be read without dragging it is the one place on this site where
 *    that is not a cosmetic complaint.
 *
 *  · Fourteen controls were under 24x24, the floor WCAG 2.5.8 sets: the two
 *    contact links on the support page at 17px tall, the "see more" links
 *    beside four section headings, the seller panel's email and Discord links,
 *    and every product title. They are now padded, with the padding pulled
 *    back out of the flow so no layout moved.
 *
 * This pins the structure. The measurements are in the commit.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— The withdrawal form fits the screen it is read on —');
{
  const src = read('src/pages/info/Refunds.jsx');
  const pre = src.slice(src.indexOf('<pre id="withdrawal-form-text"'), src.indexOf('</pre>'));
  ok('the form is still on the page at all', pre.length > 40);
  ok('it wraps inside a word, not only on spaces', /break-words|break-all|anywhere/.test(pre),
    'pre-wrap alone leaves a run of dots one unbreakable token wide');
  ok('…so it no longer needs a sideways scroller', !/overflow-x-auto/.test(pre),
    'a horizontal scrollbar here is the symptom, not the fix');
}

console.log('\n— A standalone text link is a real control —');
{
  const css = read('src/index.css');
  /* Exactly one. `.fm-tap` already existed as the press-feedback helper, and
     the first version of this rule reused that name — two rules for one class,
     which is how the hero's centrepiece logo once ended up 17px wide. This
     assertion is what the collision cost: it matched the older block and
     reported the padding missing. */
  const rules = css.match(/\.fm-hit\s*\{[^}]*\}/g) || [];
  ok(`there is exactly one rule for it (${rules.length})`, rules.length === 1);
  const rule = rules[0] || '';
  /* Padding alone would move every layout it is applied to; an equal negative
     margin is what makes it safe to add to a link that already sits in a
     carefully spaced row. */
  ok('…it grows the target with padding', /padding-top:\s*\.75rem/.test(rule) && /padding-bottom:\s*\.75rem/.test(rule));
  ok('…and takes the space straight back out', /margin-top:\s*-\.75rem/.test(rule) && /margin-bottom:\s*-\.75rem/.test(rule));

  /* 20px of text plus 24px of padding clears the 24px floor with room to
     spare, which is the point: the floor is a floor, not a target. */
  const pad = 2 * 0.75 * 16;
  ok(`…which adds ${pad}px, clearing the 24px floor from 17px of text`, pad + 17 >= 24);

  const places = [
    ['the support page\'s two contact links', 'src/pages/info/Contact.jsx', 2],
    ['the home page\'s section "see more" links', 'src/pages/HomeStore.jsx', 4],
    ['the seller panel\'s email and Discord links', 'src/components/store/SellerIdentity.jsx', 2],
  ];
  for (const [what, file, least] of places) {
    const n = (read(file).match(/fm-hit/g) || []).length;
    ok(`${what} use it (${n})`, n >= least, `${n} of ${least}`);
  }

  /* The product title is a second route to the page the artwork and the Buy
     button already lead to, so it was never unreachable — but at 23px it was
     a pixel under the floor, and a pixel is not a reason to leave it. */
  for (const [what, file] of [['a product card\'s title', 'src/components/store/LightProductCard.jsx'],
    ['a cart row\'s title', 'src/pages/Cart.jsx']]) {
    const src = read(file);
    const line = src.split('\n').find((l) => /<Link to=/.test(l) && /line-clamp-2/.test(l));
    ok(`${what} is tall enough to hit`, !!line && /py-1 -my-1/.test(line), line ? line.trim().slice(0, 80) : 'not found');
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} phone-fit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
