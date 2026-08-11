/**
 * Text has to be readable on the surface it actually sits on.
 *
 * The light theme remaps a set of dark-theme colours so they work on light
 * cards. Every one of those values is a contrast decision, and three of them
 * were wrong in a way nothing could catch:
 *
 *  - the statutory withdrawal notice on /refunds measured 1.31:1. It used
 *    `text-amber-300/90`, and Tailwind's opacity modifier makes that a
 *    different class name than the `.text-amber-300` the theme remaps — so the
 *    remap silently missed it and pale amber landed on a white card.
 *  - the selected category chip on /shop measured 3.13:1, then 4.35:1. It
 *    hand-rolled `bg-violet-600 text-white` instead of using `.chip-active`,
 *    which the theme already handles, so its white fell through to the global
 *    remap that turns `text-white` into slate-900.
 *  - the slate captions were tuned against pure white and shipped with a
 *    comment admitting they landed "just under AA". On the real page ground
 *    (#f6f7fb) they were 4.24:1, so timestamps and hints on /reviews, /refunds
 *    and /drops all failed.
 *
 * Measured in a real browser across 14 routes, the page now has zero failures.
 * A browser is too slow for this suite, so what is pinned here is the thing a
 * future edit would break: the values themselves, checked with the same WCAG
 * formula against the grounds they are used on.
 */
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const fs = await import('node:fs');
const css = fs.readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

// ── WCAG 2.1 relative luminance + contrast ratio ────────────────────────────
const srgb = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};
const AA = 4.5;

// Sanity-check the maths against values everyone knows.
console.log('— The measuring stick itself —');
{
  ok('black on white is 21:1', ratio('#000000', '#ffffff') === 21);
  ok('white on white is 1:1', ratio('#ffffff', '#ffffff') === 1);
  ok('#767676 on white is the classic 4.54:1', ratio('#767676', '#ffffff') === 4.54,
    String(ratio('#767676', '#ffffff')));
}

/**
 * Read a declared colour out of the stylesheet.
 *
 * Takes the LAST matching rule, not the first: CSS cascades, and this file has
 * carried duplicate declarations for the same selector before — where the
 * readable value only won because it happened to be written further down.
 * Reading the first match would have reported the dead one.
 */
const expand = (hex) => (hex.length === 4
  ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex);
const declared = (selector, prop = 'color') => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...css.matchAll(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  for (const rule of rules.reverse()) {
    const hit = rule[1].match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(#[0-9a-fA-F]{3,6})`));
    if (hit) return expand(hit[1]);
  }
  return null;
};

// The two grounds this text really sits on: the page and a plain card.
const GROUND = '#f6f7fb';
const CARD = '#ffffff';

// ── 1. The muted text colours ───────────────────────────────────────────────
console.log('\n— Muted text passes on the page ground, not just on white —');
{
  for (const cls of ['.text-slate-400', '.text-slate-500']) {
    const c = declared(`.theme-light ${cls}`);
    ok(`${cls} is remapped for the light theme`, !!c, 'no light-theme value found');
    if (!c) continue;
    for (const [name, bg] of [['page', GROUND], ['card', CARD]]) {
      const r = ratio(c, bg);
      ok(`${cls} (${c}) passes AA on the ${name}`, r >= AA, `${r}:1`);
    }
  }

  // Two live rules for one selector is how the unreadable value survived: it
  // was overridden by source order alone.
  for (const cls of ['.text-slate-400', '.text-slate-500', '.text-white']) {
    const n = [...css.matchAll(new RegExp(`\\.theme-light \\${cls}\\s*\\{`, 'g'))].length;
    ok(`${cls} is declared exactly once for the light theme`, n === 1, `${n} rules`);
  }
}

// ── 2. The selected category chip ───────────────────────────────────────────
console.log('\n— The selected chip is the control that says where you are —');
{
  const bg = declared('.theme-light .chip-active', 'background');
  const fg = declared('.theme-light .chip-active', 'color');
  ok('the light theme styles .chip-active', !!bg && !!fg, `bg=${bg} fg=${fg}`);
  if (bg && fg) {
    const r = ratio(fg, bg);
    ok(`its label passes AA (${fg} on ${bg})`, r >= AA, `${r}:1`);
  }

  // …and the chips must actually use that class, or the theme cannot reach them.
  const shop = fs.readFileSync(new URL('../../src/pages/Shop.jsx', import.meta.url), 'utf8');
  ok('the shop chips use .chip-active for the selected state',
    /\?\s*'chip-active'/.test(shop), 'still hand-rolling bg-violet-600 text-white');
  ok('…and no longer set text-white on a violet background themselves',
    !/bg-violet-600 text-white/.test(shop), 'the raw utility pairing is back');
}

// ── 3. The colours the remap covers must be readable where they are used ────
console.log('\n— Every remapped accent works on a light card —');
{
  const remaps = [...css.matchAll(/\.theme-light \.text-(amber|emerald|red|indigo|violet|blue|fuchsia)-\d00[^{]*\{\s*color:\s*(#[0-9a-fA-F]{6})/g)];
  ok('the light theme remaps the accent colours', remaps.length >= 6, `n=${remaps.length}`);
  const seen = new Set();
  for (const [, family, hex] of remaps) {
    if (seen.has(hex)) continue;
    seen.add(hex);
    const r = ratio(hex, CARD);
    ok(`${family} (${hex}) passes AA on a card`, r >= AA, `${r}:1`);
  }
}

// ── 4. The trap that hid all of this ────────────────────────────────────────
console.log('\n— Opacity modifiers do not silently escape the remap —');
{
  // `text-amber-300/90` is a different class name than `text-amber-300`, so an
  // exact selector misses it. Widening the selector is not the fix — it would
  // also catch `hover:text-amber-300` and repaint it permanently — so the rule
  // is simply that no page relies on the remap through a modifier.
  const pages = fs.readdirSync(new URL('../../src/pages/info', import.meta.url))
    .filter((f) => f.endsWith('.jsx'));
  const offenders = [];
  for (const f of pages) {
    const src = fs.readFileSync(new URL(`../../src/pages/info/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/className="[^"]*\btext-(amber|emerald|red|indigo|violet|blue|fuchsia)-[23]00\/\d+/g)) {
      offenders.push(`${f}: ${m[0].slice(11, 60)}`);
    }
  }
  ok('no legal page paints text through an unremapped opacity modifier',
    offenders.length === 0, offenders.join(' | '));

  const refunds = fs.readFileSync(new URL('../../src/pages/info/Refunds.jsx', import.meta.url), 'utf8');
  ok('the missing-address notice is styled as a notice, not pale text',
    /border-amber-500\/40[\s\S]{0,80}text-amber-800/.test(refunds), 'the notice lost its treatment');
  const amber800 = '#92400e'; // Tailwind amber-800
  ok(`its text (${amber800}) passes AA on the tinted panel`,
    ratio(amber800, '#fdf4e3') >= AA, `${ratio(amber800, '#fdf4e3')}:1`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
