/**
 * The page a worried buyer opens.
 *
 * /track was a heading, one sentence and an input box: eight words on an empty
 * screen. And it asked for the one thing a guest buyer here is most likely not
 * to have — checkout needs no account, so the order number exists in a tab they
 * closed and an email that may not have arrived. Someone who has lost it lands
 * on a page that can only ask for it again.
 *
 * Two changes, pinned here: the numbers placed on this device are offered back,
 * and the four questions that actually bring people to this page are answered
 * before they ask.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— The device remembers the numbers, and nothing else —');
{
  /* A localStorage that behaves like the real one, so this is the module's own
     behaviour and not a mock of it. */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { rememberMyOrder, myOrders, forgetMyOrder } = await import(join(ROOT, 'src/lib/myOrders.js'));

  rememberMyOrder('FM-2026-AAAAAAAA');
  ok('an order placed here is remembered', myOrders()[0] === 'FM-2026-AAAAAAAA');

  rememberMyOrder('fm-2026-bbbbbbbb');
  ok('…normalised the way the page shows it', myOrders()[0] === 'FM-2026-BBBBBBBB');
  ok('…newest first', myOrders()[1] === 'FM-2026-AAAAAAAA');

  rememberMyOrder('FM-2026-AAAAAAAA');
  ok('looking one up again moves it up rather than duplicating it',
    myOrders().length === 2 && myOrders()[0] === 'FM-2026-AAAAAAAA', myOrders().join(','));

  for (let n = 0; n < 10; n++) rememberMyOrder(`FM-2026-C${String(n).padStart(7, '0')}`);
  ok('the list stays a shortcut rather than becoming a page', myOrders().length <= 6, `${myOrders().length}`);

  const keep = myOrders()[1];
  forgetMyOrder(myOrders()[0]);
  ok('a buyer can drop one from their own device', myOrders()[0] === keep);

  rememberMyOrder('');
  rememberMyOrder(null);
  ok('nothing empty ever lands in the list', myOrders().every(Boolean));

  /* An order number and nothing else. The whole file is public-by-design: the
     lookup it opens is the same one anyone holding that number can already
     run, and the number itself was in the buyer's own address bar. An email or
     a total in here would be a different promise. */
  const stored = JSON.parse(store.get('fm_my_orders'));
  const keys = new Set(stored.flatMap((e) => Object.keys(e)));
  ok('only the number and when it was seen are stored',
    [...keys].every((k) => ['number', 'at'].includes(k)), [...keys].join(','));

  /* Months of a browser is a long time; a stale number must not stay.

     Read off the source rather than pinned to a number here — but read as an
     EXPRESSION, not as its first integer. `TTL_MS = (\d+)` against
     `90 * 24 * 60 * 60 * 1000` matched the 90, so the first version of this
     check aged an entry by ninety milliseconds and then reported the module
     broken for keeping it. */
  const src = read('src/lib/myOrders.js');
  const ttl = Number(new Function(`return ${src.match(/TTL_MS = ([^;]+);/)[1]}`)());
  ok(`entries expire after ${Math.round(ttl / 86400000)} days`,
    Number.isFinite(ttl) && ttl > 7 * 86400000, `${ttl}ms`);
  store.set('fm_my_orders', JSON.stringify([{ number: 'FM-2026-OLD', at: Date.now() - ttl - 1000 }]));
  ok('…and an expired number is gone', myOrders().length === 0, myOrders().join(','));
  store.set('fm_my_orders', JSON.stringify([{ number: 'FM-2026-NEW', at: Date.now() - ttl + 60_000 }]));
  ok('…while one just inside the window stays', myOrders()[0] === 'FM-2026-NEW');

  /* Storage that throws (private mode, blocked cookies) must not take the page
     with it — this is the page someone opens when they are already worried. */
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  let threw = false;
  try { rememberMyOrder('FM-2026-DDDDDDDD'); myOrders(); forgetMyOrder('x'); } catch { threw = true; }
  ok('blocked storage degrades to an empty list rather than an error', !threw);
}

console.log('\n— …and it is filled in on the way past —');
{
  const checkout = read('src/pages/Checkout.jsx');
  ok('checkout remembers the number it just created', /rememberMyOrder\(order\.number\)/.test(checkout));
  /* Once, before the provider branches. Five exit paths meant five chances to
     forget one, and the one most likely to be forgotten is the redirect to an
     external payment page — the exact case where the tab does not come back. */
  ok('…once, not per payment provider',
    (checkout.match(/rememberMyOrder\(/g) || []).length === 1);
  const at = checkout.indexOf('rememberMyOrder(order.number)');
  ok('…before the redirect that takes the buyer off the site',
    at > 0 && at < checkout.indexOf("if (provider === 'mollie')"));

  const track = read('src/pages/Track.jsx');
  ok('the track page remembers a number that resolved', /rememberMyOrder\(r\.number\)/.test(track));
}

console.log('\n— The empty screen answers the questions people arrive with —');
{
  const track = read('src/pages/Track.jsx');
  const empty = track.slice(track.indexOf('{!result && !busy && ('), track.indexOf('function HelpCard'));
  ok('there is an empty state at all', empty.length > 500, `${empty.length} chars`);

  const cards = (empty.match(/<HelpCard/g) || []).length;
  ok(`it answers ${cards} questions`, cards >= 4, `${cards}`);

  /* Every one of them through t(), or a German reader meets an English page
     the moment they need it most. The keys themselves are checked against all
     four dictionaries by languages.test. */
  const strings = [...empty.matchAll(/(title|body)=\{([^}]*)\}/g)].map((m) => m[2]);
  ok('every question and answer goes through the dictionary',
    strings.length >= 8 && strings.every((v) => v.trim().startsWith('t(')),
    strings.filter((v) => !v.trim().startsWith('t(')).join(' | '));

  const nl = read('src/lib/i18n.jsx');
  const de = read('src/lib/i18n/de.js');
  const fr = read('src/lib/i18n/fr.js');
  const keys = [...empty.matchAll(/t\('([a-z.]+)'/gi)].map((m) => m[1]);
  ok(`${new Set(keys).size} keys, all written in every language`,
    [...new Set(keys)].every((k) => [nl, de, fr].every((d) => d.includes(`'${k}':`))),
    [...new Set(keys)].filter((k) => ![nl, de, fr].every((d) => d.includes(`'${k}':`))).join(', '));

  /* It must not appear over a result. Someone reading their own order status
     does not need to be told where to find their order number. */
  ok('it hides as soon as there is something to show', /\{!result && !busy && \(/.test(track));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
