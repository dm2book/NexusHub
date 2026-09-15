/**
 * The hero artwork: the hand of gift cards at the top of the homepage.
 *
 * It is built entirely in CSS from brand icons the shop already ships — no new
 * image, no invented card artwork, no denomination printed on a card that the
 * shop does not sell. That is cheap to keep true and easy to break, so the
 * rules that hold it together are written down here.
 *
 * Two of these assertions exist because of bugs that actually shipped:
 *
 *  1. A class named `fm-orbit` was defined TWICE — once as the loading spinner
 *     (`width: 1em`) and once as the hero's idle drift. The spinner rule won,
 *     and the centrepiece logo rendered at 17×17 instead of 150×150 on the
 *     live site. Nothing failed; it just looked wrong, and only measuring the
 *     rendered image in a browser found it.
 *
 *  2. The cards paint left to right, so every card except the last is covered
 *     on its right by the card in front of it. A mark placed in the middle of
 *     a card is a mark nobody sees: the first version of this artwork showed
 *     ONE logo out of five, and the second — corner-outward, left cards left
 *     and right cards right — cut Steam and PlayStation in half against the
 *     card in front. Only the LEFT portion of a card is reliably in view.
 *
 * These are geometry and naming rules, checked against the stylesheet and the
 * component rather than against a screenshot, so they hold in CI where there
 * is no browser.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const home = readFileSync(join(ROOT, 'src', 'pages', 'HomeStore.jsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

/** The value of one declaration inside a top-level rule block. */
const ruleBody = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return m.length ? m[m.length - 1][1] : null;
};
const px = (body, prop) => {
  const hit = body && body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(-?[\\d.]+)px`));
  return hit ? Number(hit[1]) : null;
};

// ── 1. Every class the page uses is a class the stylesheet defines ──────────
console.log('— No class points at nothing —');
{
  /* A renamed or mistyped `fm-` class does not throw and does not fail a
     build. It silently drops whatever that rule was doing.
     Only className values are read, not every `fm-` token in the tree: the
     prefix is also used for element ids, custom properties and event names,
     and none of those belong in a stylesheet. */
  const src = readdirSync(join(ROOT, 'src'), { recursive: true })
    .filter((f) => typeof f === 'string' && /\.jsx?$/.test(f))
    .map((f) => readFileSync(join(ROOT, 'src', f), 'utf8')).join('\n');
  const values = [...src.matchAll(/className\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/g)]
    .map((m) => m[1] ?? m[2]).join(' ');
  const used = new Set([...values.matchAll(/\bfm-[a-z0-9-]+/g)].map((m) => m[0]));
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
  ok(`all ${used.size} fm- classes used in src/ are defined in index.css`,
    missing.length === 0, missing.join(', '));
}

console.log('\n— …and no class means two different things —');
{
  /* The fm-orbit collision: two unrelated components sharing a name, the
     second silently inheriting the first one's box.
     Counted at the TOP LEVEL only — a rule repeated inside a @media block is
     the same component answering a different width, which is the point of a
     media query, not a name used twice. */
  const defined = [];
  let depth = 0, sel = '';
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const ch of flat) {
    if (ch === '{') {
      if (depth === 0 && !sel.trim().startsWith('@')) {
        /* Only a BARE `.fm-x` counts. `.fm-fan:hover .fm-fan-card` and
           `.fm-fan-card::after` are the same component in another state, not a
           second component wearing its name. */
        for (const one of sel.split(',')) {
          const m = one.trim().match(/^\.(fm-[a-z0-9-]+)$/);
          if (m) defined.push(m[1]);
        }
      }
      depth++; sel = '';
    } else if (ch === '}') { depth--; sel = ''; }
    else if (depth === 0) sel += ch;
  }
  const twice = defined.filter((c, i) => defined.indexOf(c) !== i);
  ok(`every fm- class has exactly one base rule (${defined.length} checked)`,
    twice.length === 0, [...new Set(twice)].join(', '));
}

// ── 2. The mark sits where the card is still visible ────────────────────────
console.log('\n— A mark you cannot see is not a mark —');
{
  const card = ruleBody('.fm-fan-card');
  const mark = ruleBody('.fm-fan-card img');
  ok('the card and its mark are both styled', !!card && !!mark);

  const cardW = px(card, 'width');
  const left = px(mark, 'left');
  const markW = px(mark, 'width');
  ok('the card has a fixed width', cardW > 0, `${cardW}`);
  ok('the mark is placed from the left edge, not centred or right-aligned',
    left != null && markW > 0, `left=${left} width=${markW}`);

  if (cardW && left != null && markW) {
    /* Only the left portion of a card survives the card in front of it. Half
       the card is the conservative bound that the two earlier versions of this
       artwork both broke. */
    ok(`the mark clears the overlap (${left}+${markW} ≤ ${cardW / 2})`,
      left + markW <= cardW / 2, `${left + markW} > ${cardW / 2}`);
    ok('…and is not flush against the edge', left >= 8, `left=${left}`);
  }

  /* One rule for all five cards. Per-card placement is exactly how the second
     version pushed the right-hand marks INTO the card in front of them. */
  ok('no card overrides the mark position', !/--m[xy]\b|--mark\b/.test(home));
  ok('the fan is not laid out with flex alignment', !/justify-content:\s*var\(/.test(card || ''));
}

// ── 3. Nothing invented ─────────────────────────────────────────────────────
console.log('\n— Real products, real files —');
{
  const block = home.match(/const FAN = \[([\s\S]*?)\];/);
  ok('the hand is declared as data, not hand-written markup', !!block);
  const icons = block ? [...block[1].matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1]) : [];
  ok('it is a hand of five', icons.length === 5, `${icons.length}`);
  ok('…with no card shown twice', new Set(icons).size === icons.length, icons.join(', '));

  const dir = join(ROOT, 'public', 'products', 'icons');
  for (const name of icons) {
    const file = ['webp', 'svg'].map((e) => join(dir, `${name}.${e}`)).find(existsSync);
    ok(`${name} has an icon on disk`, !!file, `${name}.(webp|svg) missing`);
  }

  /* Every brand the sentence beside the artwork names has a card, so the copy
     and the art cannot promise two different shops. The art may show more than
     the sentence lists — it ends in "and more" — but never less. */
  const sub = home.match(/'(Robux[^']*and more[^']*)'/);
  ok('the hero subtitle is where it was', !!sub, 'no subtitle naming brands');
  if (sub) {
    const named = sub[1].split(/\s+and more/)[0].split(/,\s*/)
      .map((b) => b.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
    for (const brand of named) {
      ok(`"${brand}" named in the copy is on a card`, icons.includes(brand),
        `cards: ${icons.join(', ')}`);
    }
  }
}

// ── 4. It still gets out of the way ─────────────────────────────────────────
console.log('\n— Motion and size —');
{
  ok('the whole hand animates as one object, not five',
    /\.fm-fan-inner\s*\{[^}]*animation:/.test(css));
  ok('…and stops for prefers-reduced-motion',
    /prefers-reduced-motion[\s\S]{0,400}\.fm-fan-inner\s*\{\s*animation:\s*none/.test(css));
  /* A phone is 390px wide and the composition is 460px. It is scaled down as
     a whole rather than reflowed, and the middle step exists because at
     1024px the fan ran off the right of the viewport. */
  ok('the composition is scaled at three widths, not two',
    (home.match(/scale-\[\.\d+\]|xl:scale-100/g) || []).length >= 3,
    String(home.match(/scale-\[[^\]]*\]|xl:scale-100/g)));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} hero-art: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
