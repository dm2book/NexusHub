/**
 * Everything that moves, and the rule that everything that moves can stop.
 *
 * This shop has a lot of motion in it now — a hand of cards that deals itself,
 * light travelling across a surface, shelves that fill, a button that answers
 * a cursor. All of that is worth having and none of it is worth having at the
 * cost of somebody who gets motion sick.
 *
 * The first block is the rule that matters and it is written generally rather
 * than as a list: ANY class that runs an animation must also appear inside a
 * prefers-reduced-motion block. A list would be a list somebody forgets to add
 * to; this fails the moment a new animation is written without an escape,
 * whoever writes it and wherever they put it.
 *
 * It checks `animation` and not `transition` on purpose. A transition is a
 * brief response to something the visitor just did; an animation runs whether
 * they asked for it or not, and usually keeps running.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const home = readFileSync(join(ROOT, 'src', 'pages', 'HomeStore.jsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

/**
 * Every selector and its declarations, at any nesting depth, with the at-rules
 * it sits inside carried along.
 *
 * Nesting matters here: the shine's animation lives inside a
 * `@media (hover: hover)` block, and a parser that only looked at the top
 * level would have declared the file clean while missing it.
 */
function rules(text) {
  const flat = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  const stack = [];
  let sel = '', body = '', depth = 0;
  for (const ch of flat) {
    if (ch === '{') {
      stack.push(sel.trim());
      depth++; sel = ''; body = '';
    } else if (ch === '}') {
      const own = stack.pop();
      if (own && !own.startsWith('@')) out.push({ sel: own, body, at: stack.filter(Boolean) });
      depth--; sel = ''; body = '';
    } else if (depth === 0) sel += ch;
    else { sel += ch; body += ch; }
  }
  return out;
}

console.log('— Anything that moves can be told to stop —');
{
  const all = rules(css);
  /* The SELECTORS inside reduced-motion blocks, gathered from the parse rather
     than by splitting the file on the at-rule. Splitting looked right and was
     not: the last piece runs from the final reduced-motion block to the end of
     the file, so anything declared below it counted as silenced by accident.
     Proved by adding an animating class with no escape at the bottom — the
     check passed. It does not now. */
  const quiet = all
    .filter((r) => r.at.some((a) => a.includes('prefers-reduced-motion')))
    .map((r) => r.sel).join(' , ');
  ok('the stylesheet has a reduced-motion section at all', quiet.length > 200, `${quiet.length} chars`);

  const animating = new Set();
  for (const r of all) {
    if (r.at.some((a) => a.includes('prefers-reduced-motion'))) continue;
    const decls = r.body.split('{')[0];             // this rule's own declarations
    if (!/(^|[;\s])animation(-name)?\s*:/.test(decls)) continue;
    if (/animation(-name)?\s*:\s*none/.test(decls)) continue;
    for (const m of r.sel.matchAll(/\.(fm-[a-z0-9-]+)/g)) animating.add(m[1]);
  }
  ok(`the shop animates ${animating.size} named things`, animating.size >= 25, `${animating.size}`);

  const loud = [...animating].filter((c) => !quiet.includes(c)).sort();
  ok('every one of them is named in the reduced-motion section',
    loud.length === 0, `${loud.length} with no escape: ${loud.join(', ')}`);
}

console.log('\n— This round’s moving parts —');
{
  const has = (re) => re.test(css);
  /* The category list: twenty-one rows that changed background colour and did
     nothing else — the most-used navigation in the shop and the least alive
     thing on the page. */
  ok('a category row grows a rail and steps toward it',
    has(/\.fm-navrow::before[\s\S]{0,300}?height:\s*0/) && has(/\.fm-navrow:hover::before\s*\{\s*height:/));
  ok('…and the selected one is that same state, already arrived',
    has(/\.fm-navrow\.is-active::before\s*\{\s*height:/));
  ok('…with the lift behind a pointer query, so a tap cannot leave it stuck',
    has(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]{0,400}?\.fm-navrow:hover/));
  ok('…and the active row is marked in the markup, not guessed from the URL',
    /is-active bg-violet-50/.test(home));

  /* A shelf fills rather than appears. */
  ok('a revealed shelf cascades its cards',
    has(/\.fm-reveal\.fm-reveal-children\.is-in \.fm-rail > \*:nth-child\(1\)\s*\{\s*transition-delay/));
  ok('…and stops staggering before a visitor starts waiting',
    has(/\.fm-rail > \*:nth-child\(n\+8\)\s*\{\s*transition-delay/));

  /* The cart count acknowledges the thing the person just did. */
  ok('the cart count pops when it changes', has(/@keyframes fmPop/));
  ok('…keyed on the count, so it runs on every change and not just the first',
    /<span key=\{count\}/.test(home));

  /* One light for "online", wherever the shop says it. */
  ok('the bot’s status light is the hero’s, not a second one',
    (home.match(/className="fm-livedot"/g) || []).length >= 2);

  ok('the filled buttons catch a light when pointed at', has(/@keyframes fmShine/));
  ok('…and only while pointed at — it is not a loop',
    has(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.fm-shine:hover::after/));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} motion: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
