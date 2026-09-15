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
/* The shipped catalogue, exported for exactly this: checking a claim about
   what the shop sells without standing up a database. */
import { CATALOG } from '../src/db/demoSeed.js';
import { landingPathFor } from '../../src/content/seo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const home = readFileSync(join(ROOT, 'src', 'pages', 'HomeStore.jsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

/**
 * Everything one selector declares, wherever it declares it.
 *
 * All of its blocks joined rather than the last one: a card is styled in one
 * place and silenced in another (the reduced-motion block), and reading only
 * the last match reported the card as having no width at all — it was reading
 * `opacity: 1 !important` and nothing else.
 */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const ruleBody = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* Read from the comment-stripped copy: the anchor is "start of file, or the
     brace that closed the rule before", and a rule introduced by a comment —
     as most of them in this file are — has a `/` in front of it instead. That
     returned null for .fm-fan-name and reported a rule that is plainly there
     as missing. */
  const m = [...cssCode.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return m.length ? m.map((x) => x[1]).join(';\n') : null;
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

console.log('\n— …and depth must not reshuffle the stack —');
{
  /* The cards live in a preserve-3d scene, and inside one of those the browser
     paints by DEPTH, not by source order. Give the middle card the largest
     translateZ and it jumps in front of the two on its right — which is
     exactly what happened the first time depth was added here, and it hid the
     PlayStation and Nitro marks under the card that is written behind them.
     As long as z never falls from left to right, the two orders agree. */
  const block = home.match(/const FAN = \[([\s\S]*?)\];/);
  const z = block ? [...block[1].matchAll(/z:\s*'(-?[\d.]+)px'/g)].map((m) => Number(m[1])) : [];
  ok('every card declares a depth', z.length === 5, `${z.length}`);
  ok(`depth never falls from left to right (${z.join(' → ')})`,
    z.every((v, i) => i === 0 || v >= z[i - 1]));

  /* The hover lift moves a card forward by LESS than one step of that depth,
     so the card that rises stays in its place in the hand. Lifting it clear
     of everything took the mark of the card behind it with it. */
  const step = z.length > 1 ? Math.min(...z.slice(1).map((v, i) => v - z[i])) : 0;
  const lift = Number((css.match(/--z:\s*calc\(var\(--z0[^)]*\)\s*\+\s*(\d+)px\)/) || [])[1]);
  ok(`the hover lift (${lift}px) stays inside one depth step (${step}px)`,
    Number.isFinite(lift) && lift > 0 && lift < step, `lift=${lift} step=${step}`);
}

console.log('\n— One transform, four numbers —');
{
  /* Resting, dealt, spread and picked up are four states of one card. Each
     one written as a full transform chain is four copies to keep in step, and
     the copies WILL drift — the spread-on-hover rule had already lost the
     translateZ the base rule gained. Registering the four numbers is what
     lets every state be a number instead of a chain. */
  for (const prop of ['--a', '--y', '--s', '--z']) {
    ok(`${prop} is registered, so it can animate`,
      new RegExp(`@property\\s+\\${prop}\\s*\\{`).test(css));
  }
  const chains = [...css.matchAll(/transform:\s*rotate\(var\(--a\)\)[^;]*/g)];
  ok('the transform chain is written exactly once', chains.length === 1, `${chains.length} copies`);

  /* `backwards`, never `forwards`: a finished forwards animation outranks
     every rule below it, and the hand would deal itself and then refuse to
     spread, lift or tilt for the rest of the visit. */
  const deal = ruleBody('.fm-fan-card');
  ok('the deal hands control back when it ends',
    /animation:[^;]*\bbackwards\b/.test(deal || '') && !/animation:[^;]*\bforwards\b/.test(deal || ''));
  ok('…and the deal keyframe has no second copy of the resting numbers',
    /@keyframes fmFanDeal\s*\{\s*from\s*\{[^}]*\}\s*\}/.test(css.replace(/\/\*[\s\S]*?\*\//g, ' ')));
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

/* ── Where a card goes ──────────────────────────────────────────────────── */
  console.log('\n  · a click has to land somewhere real ·');
  /* Five brand logos at the top of a shop are five things a visitor will try
     to click. Three of these brands are categories; two are NOT. There is no
     `steam` and no `playstation` category in this catalogue — Steam Wallet and
     the PlayStation Store card are filed under `giftcard` — so the obvious
     link, /steam, would have been a 404 wearing a product's logo.
     Checked against the shipped catalogue, not against a memory of it. */
  const CARDS = [...block[1].matchAll(
    /icon:\s*'([^']+)',\s*brand:\s*'([^']+)',\s*cat:\s*'([^']+)'(?:,\s*find:\s*'([^']+)')?/g)]
    .map((m) => ({ icon: m[1], brand: m[2], cat: m[3], find: m[4] }));
  ok('every card declares where it goes', CARDS.length === 5, `${CARDS.length} of 5`);

  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const c of CARDS) {
    const inCat = CATALOG.filter((p) => p.category === c.cat);
    ok(`${c.brand} → a category the shop actually has (${c.cat})`, inCat.length > 0,
      'no product carries that category');
    /* And the destination must show THIS brand, not merely exist. A logo that
       drops you in a shelf of ten unrelated cards is a dead end with a picture
       on it. */
    const found = inCat.filter((p) => !c.find || norm(p.name).includes(norm(c.find)));
    ok(`   …with ${c.brand} products on it (${found.length})`, found.length > 0,
      c.find ? `nothing in ${c.cat} matches "${c.find}"` : `${c.cat} is empty`);
    if (c.find) {
      ok(`   …and the search narrows it (${found.length} of ${inCat.length})`,
        found.length < inCat.length, 'the search filters nothing out');
    } else {
      ok(`   …and ${c.brand} needs no search to find it`,
        inCat.every((p) => norm(p.category) === norm(c.cat)));
    }
    const href = c.find
      ? `${landingPathFor(c.cat)}?search=${encodeURIComponent(c.find)}`
      : landingPathFor(c.cat);
    ok(`   ${href}`, !href.includes('undefined') && href.startsWith('/'), href);
  }

  /* Links, not pictures of links. And each one has to say what it is: five
     cards all announcing themselves as "image" is a menu with no labels. */
  ok('the cards are links', /<Link key=\{c\.icon\} to=\{fanHref\(c\)\}/.test(home));
  ok('…each with a name a screen reader can read', /aria-label=\{tr\('home\.fanGo'/.test(home));
  ok('…and the mark itself stays silent, not read out twice',
    /className="fm-fan-card"[\s\S]{0,400}?alt=""/.test(home));
  ok('the card is a block, so the link is the whole card',
    /display:\s*block/.test(ruleBody('.fm-fan-card') || ''));

  /* The brand up the left edge. It exists because two thirds of every card
     was empty, and it can only live on the left because that is the only
     strip the card in front leaves showing. Anchored to the FOOT: set from
     the top, DISCORD NITRO ran off the bottom of its own card. */
  ok('every card carries its brand as well as its mark',
    (home.match(/className="fm-fan-name"/g) || []).length === 1
    && CARDS.every((c) => c.brand));
  const name = ruleBody('.fm-fan-name') || '';
  ok('…set up the edge, not across the face', /writing-mode:\s*vertical/.test(name));
  ok('…anchored to the foot so the longest still fits', /bottom:\s*\d+px/.test(name)
    && !/(^|;)\s*top:/.test(name), name.trim().slice(0, 60));
  ok('…and silent to a screen reader, which already heard it from the link',
    /className="fm-fan-name" aria-hidden/.test(home));
  ok('…and the keyboard can see where it is',
    /\.fm-fan-card:focus-visible\s*\{[^}]*outline:/.test(css));

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

  /* Everything that moves has to be able to stop. Each of these is a separate
     animation on a separate element, so each is a separate way to miss one. */
  const quiet = css.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n');
  for (const sel of ['.fm-fan-inner', '.fm-fan-card', '.fm-fan-card::after', '.fm-fan-glow']) {
    ok(`${sel} stops for prefers-reduced-motion`, quiet.includes(sel), 'not listed');
  }
  ok('…and the tilt goes with it', /\.fm-fan-tilt\s*\{\s*transform:\s*none/.test(quiet));
  ok('…and so do the glints', quiet.includes('.fm-glint'), 'not listed');
  /* The hook refuses on its own too: a touch screen has no pointer to follow,
     and every listener there is a scroll cost for an effect nobody can see. */
  const tilt = readFileSync(join(ROOT, 'src', 'lib', 'usePointerTilt.js'), 'utf8');
  ok('the tilt hook asks before listening at all',
    /prefers-reduced-motion/.test(tilt) && /hover: hover/.test(tilt));
  ok('…and writes at most once a frame', /requestAnimationFrame/.test(tilt));
  /* A phone is 390px wide and the composition is 460px. It is scaled down as
     a whole rather than reflowed, and the middle step exists because at
     1024px the fan ran off the right of the viewport. */
  ok('the composition is scaled at three widths, not two',
    (home.match(/scale-\[\.\d+\]|xl:scale-100/g) || []).length >= 3,
    String(home.match(/scale-\[[^\]]*\]|xl:scale-100/g)));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} hero-art: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
