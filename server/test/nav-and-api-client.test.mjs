/**
 * Two failures a buyer reported from a phone, and the reason each survived
 * every other test in this repo.
 *
 *  1. `JSON Parse error: Unexpected identifier "A"`. The API client parsed every
 *     response body with a bare JSON.parse. When something in FRONT of the API
 *     answers instead — Vercel returns the plain text "A server error has
 *     occurred" when a function crashes on boot, a CDN returns an HTML block
 *     page, a proxy returns a gateway error — the parse threw a SyntaxError
 *     straight into the UI. The buyer got a message about JSON; the owner got
 *     pointed at the wrong layer entirely.
 *
 *  2. The header's Sign Up button was clipped off the right edge. The row was
 *     sized around the English label: "Sign Up" is 7 characters and fitted,
 *     "Account maken" is 13 and did not. Measured overflow before the fix, in
 *     Dutch: 59px at 320, 99px at 414, 107px at 640, 102px at 768, 254px at
 *     1024. Every viewport test in the repo runs in English, so none of them
 *     saw it.
 *
 * Both are the same failure of imagination: code that works for the default
 * case — a well-behaved JSON API, a short English string — and was never asked
 * what the other case looks like. So these tests assert the GUARD exists rather
 * than the happy path, because the happy path never broke.
 */
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const fs = await import('node:fs');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const api = read('../../src/lib/api.js');
const home = read('../../src/pages/HomeStore.jsx');
const nav = read('../../src/components/store/StoreNav.jsx');
const i18n = read('../../src/lib/i18n.jsx');

// ── 1. The API client survives a body that is not JSON ──────────────────────
console.log('— A non-JSON response must not throw SyntaxError at the UI —');
{
  // No bare JSON.parse of a response body anywhere in the client.
  const bare = /(?<!try\s*\{\s*)return JSON\.parse\(text\)(?!\s*;?\s*\}\s*catch)/.test(api);
  ok('the response body is never parsed outside a try', !bare, 'unguarded JSON.parse(text) remains');
  ok('there is a parse helper that cannot throw',
    /function parseJson\([\s\S]{0,220}try \{ return JSON\.parse/.test(api), 'no guarded parseJson helper');

  // A sentinel is needed: `null` is a legitimate parse result, so "failed to
  // parse" and "parsed to null" must be distinguishable.
  ok('unparseable is distinguished from a body that parsed to null',
    /UNPARSEABLE\s*=\s*Symbol\(/.test(api), 'no sentinel — null and "not JSON" collapse together');

  ok('an unparseable body becomes an Error with the HTTP status attached',
    /data === UNPARSEABLE[\s\S]{0,420}err\.status = res\.status/.test(api),
    'status is lost, so callers cannot branch on 500 vs 404');
  ok('…and a message a buyer can read, not the raw body',
    /data === UNPARSEABLE[\s\S]{0,400}(trouble right now|unexpected response)/.test(api));
  ok('…while the body is kept for diagnosis',
    /data === UNPARSEABLE[\s\S]{0,500}err\.body = text\.slice/.test(api), 'evidence discarded');

  // refresh() runs on the FIRST request of every session, before any page has
  // rendered its own error state. res.json() there throws just as hard.
  ok('the token refresh does not call res.json() either',
    !/refresh\(\)[\s\S]{0,600}await res\.json\(\)/.test(api), 'res.json() still in refresh()');
  ok('the token refresh parses through the same guard',
    /refresh[\s\S]{0,600}parseJson\(await res\.text\(\)/.test(api));
}

// ── 2. The header cannot push its call to action off the screen ─────────────
console.log('\n— The header row fits in any language —');
{
  // The homepage carries its own copy of the nav, and it is the copy that keeps
  // a Sign Up button visible at every width — so it is the one that overflowed.
  const signup = home.match(/aria-label=\{tr\('nav\.signup'[\s\S]{0,1400}?<\/Link>/)?.[0] || '';
  ok('the homepage Sign Up button exists and is labelled', signup.length > 0);
  ok('it is capped so it can never reach past the viewport',
    /max-w-\[\d+vw\]/.test(signup), 'no max-width cap');
  ok('a label too long for the cap truncates instead of overflowing',
    /<span className="[^"]*truncate[^"]*">\{tr\('nav\.signup'/.test(signup));
  ok('below 400px it falls back to an icon rather than a truncated word',
    /UserPlus[\s\S]{0,80}xs:hidden/.test(signup), 'no icon-only fallback');
  ok('the icon-only state is still named for screen readers',
    /aria-label=\{tr\('nav\.signup'/.test(signup));

  // The store nav on every other page hides the button below sm, but still had
  // to fit it beside the desktop links.
  const navSignup = nav.match(/\{!loading && !user && \([\s\S]{0,700}?<\/Link>/)?.[0] || '';
  ok('the store nav Sign Up button is capped too', /max-w-\[\d+vw\]/.test(navSignup));
  ok('…and truncates rather than overflowing', /truncate/.test(navSignup));

  for (const [label, src] of [['homepage', home], ['store nav', nav]]) {
    // "Hoe het werkt" wrapped onto three lines and tripled the header height.
    ok(`${label}: desktop links never wrap`,
      /relative py-1 whitespace-nowrap/.test(src), 'nav links can wrap');
    // The search placeholder broke onto two lines once the box was squeezed.
    ok(`${label}: the search label never wraps`,
      /text-sm truncate whitespace-nowrap/.test(src), 'search label can wrap');
    // Six 24px gaps is 144px of a 390px row.
    ok(`${label}: the row gap is smaller on small screens`,
      /gap-3 sm:gap-4 xl:gap-6/.test(src), 'row still uses one gap at every width');
    // The wordmark is the one thing that can go: the mark says the same thing.
    ok(`${label}: the wordmark waits for a width that fits it whole`,
      /hidden xl:inline[^"]*">ForgeMarket</.test(src), 'wordmark shown where it only truncates');
  }

  // Both link to /login on a passwordless shop, so one of them is redundant
  // until there is room to spare.
  ok('the redundant text login link only appears when there is room',
    /hidden xl:inline-flex shrink-0[\s\S]{0,140}nav\.login/.test(nav));
}

// ── 3. The labels that made it overflow ─────────────────────────────────────
console.log('\n— Navigation labels are labels, not sentences —');
{
  const nl = (k) => i18n.match(new RegExp(`'${k}': '([^']*)'`))?.[1] || '';
  // Only the keys the header actually renders. There is 0px of headroom left at
  // 1024px in Dutch, so a label growing past this is the thing that breaks it.
  for (const k of ['nav.products', 'nav.howShort', 'nav.support', 'nav.reviews', 'nav.home']) {
    const v = nl(k);
    ok(`${k} = "${v}" is short enough for a nav bar`, v.length > 0 && v.length <= 12, `${v.length} chars`);
  }
  // …and the long form still exists, because /payment-methods renders it as a
  // heading where "Uitleg" would be too thin.
  ok('the full "how it works" phrase survives for use as a heading',
    nl('nav.how') === 'Hoe het werkt', nl('nav.how'));
  ok('the header uses the short key, not the heading one',
    /nav\.howShort/.test(home) && /nav\.howShort/.test(nav) && !/t\('nav\.how',/.test(nav));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
