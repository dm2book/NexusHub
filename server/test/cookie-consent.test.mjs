/**
 * Cookie consent that actually withholds consent.
 *
 * Dutch and EU law (Art. 11.7a Telecommunicatiewet, ePrivacy + GDPR) require
 * permission BEFORE anything non-essential is written to a visitor's device.
 * What shipped before was worse than having nothing, because it looked like
 * compliance while providing none of it:
 *
 *  - the banner lived in SiteLayout, which App.jsx never renders — dead code,
 *    shown to nobody;
 *  - it offered only "Accept". Refusing has to be as easy as agreeing, or the
 *    consent is not freely given and therefore is not consent;
 *  - it claimed "we use essential cookies", which was untrue: the analytics
 *    visitor id and the referral code are neither;
 *  - it said "by using ForgeMarket you agree" — implied consent, explicitly
 *    invalid;
 *  - and nothing was gated on it. Measured in a browser: a fresh visit stored
 *    `fm_sid` before the banner had rendered.
 *
 * Measured after the fix, over three fresh browser sessions:
 *   before answering  → fm_cart only,               0 tracking requests
 *   after refusing    → fm_cart + the choice,       0 tracking requests
 *   after accepting   → + fm_sid + fm_ref,          2 tracking requests
 *
 * A browser is too slow for this suite, so what is pinned here is the wiring a
 * future edit would quietly break.
 */
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const fs = await import('node:fs');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const consent = read('../../src/lib/consent.js');
const banner = read('../../src/components/CookieConsent.jsx');
const views = read('../../src/lib/usePageViews.js');
const storeLayout = read('../../src/layouts/StoreLayout.jsx');
const home = read('../../src/pages/HomeStore.jsx');
const footer = read('../../src/components/store/StoreFooter.jsx');
const i18n = read('../../src/lib/i18n.jsx');

// ── 1. Refusal is the default ───────────────────────────────────────────────
console.log('— No answer means no permission —');
{
  ok('there is a single module deciding what is allowed', /export function allowed\(/.test(consent));
  ok('essential storage never needs asking', /category === 'essential'\) return true/.test(consent));
  ok('everything else defaults to refused',
    /return !!c && c\[category\] === true/.test(consent),
    'an unanswered banner must not count as permission');
  ok('a stored choice is versioned, so new categories ask again',
    /CONSENT_VERSION/.test(consent) && /c\.v === CONSENT_VERSION/.test(consent));
  ok('refusing also deletes what was already stored for that category',
    /function purgeRefused/.test(consent) && /removeItem\(k\)/.test(consent),
    'refusing only stops future writes and leaves the old identifier behind');
  ok('the essential keys are never purged',
    /ESSENTIAL_KEYS\.includes\(k\)\) continue/.test(consent));
}

// ── 2. The things that must wait ────────────────────────────────────────────
console.log('\n— Nothing non-essential is written before the answer —');
{
  ok('page-view tracking is gated on analytics consent',
    /allowed\('analytics'\)/.test(views), 'the beacon still fires unconditionally');
  ok('…and it stores no visitor id until then',
    /if \(!ok\) return;[\s\S]{0,120}sessionId\(\)/.test(views),
    'sessionId() runs before the consent check, so fm_sid is written anyway');
  ok('…and it starts counting the moment consent arrives, without a reload',
    /onConsentChange/.test(views));

  for (const [label, src] of [['store layout', storeLayout], ['homepage', home]]) {
    ok(`${label}: the referral code waits for marketing consent`,
      /ref && allowed\('marketing'\)/.test(src), 'fm_ref is stored regardless');
    ok(`${label}: …and is captured if consent arrives while still on the page`,
      /onConsentChange\(store\)/.test(src), 'a referral link + accept loses the credit');
  }
}

// ── 3. Refusing is as easy as accepting ─────────────────────────────────────
console.log('\n— A choice, not a formality —');
{
  ok('the banner offers both answers', /cookie\.accept/.test(banner) && /cookie\.reject/.test(banner));
  const accept = banner.match(/decide\(true\)[^>]*className="([^"]*)"/)?.[1] || '';
  const reject = banner.match(/decide\(false\)[^>]*className="([^"]*)"/)?.[1] || '';
  ok('both buttons exist and are found', !!accept && !!reject, `accept=${!!accept} reject=${!!reject}`);
  ok('…and are the same size and weight',
    accept.includes('flex-1') && reject.includes('flex-1')
      && accept.includes('py-2.5') && reject.includes('py-2.5'),
    'refusal is visually demoted, which makes the consent unfree');
  ok('refusing really means refusing', /decide\(false\)/.test(banner)
    && /setConsent\(\{ analytics: yes, marketing: yes \}\)/.test(banner));

  ok('it does not claim consent from mere use',
    !/by using|door de site te gebruiken/i.test(banner + i18n.split('cookie.body')[1]?.slice(0, 300) || ''),
    'implied consent is not consent');
  ok('it links to the page that lists what is stored', /to="\/cookies"/.test(banner));
}

// ── 4. It is actually rendered ──────────────────────────────────────────────
console.log('\n— Mounted where visitors are, not in a layout nobody renders —');
{
  ok('the store layout renders it', /<CookieConsent \/>/.test(storeLayout));
  // The homepage builds its own chrome instead of using StoreLayout, so it
  // needs its own mount — this is exactly how the old banner reached nobody.
  ok('the homepage renders it too', /<CookieConsent \/>/.test(home),
    'the most visited page would show no banner at all');

  const app = read('../../src/App.jsx');
  ok('the layout it lives in is the one the router uses', /StoreLayout/.test(app));
  ok('SiteLayout is not the only mount point any more',
    !/SiteLayout/.test(app) || /<CookieConsent/.test(storeLayout));
}

// ── 5. Withdrawal ───────────────────────────────────────────────────────────
console.log('\n— Changing your mind is as easy as the first answer —');
{
  ok('there is a way to reopen the choice', /export function resetConsent/.test(consent));
  ok('…reachable from every page', /CookiePreferencesLink/.test(footer),
    'withdrawal lives only in a banner that never comes back');
  ok('…and it clears the categories again', /resetConsent[\s\S]{0,220}purgeRefused/.test(consent));
}

// ── 6. Dutch ────────────────────────────────────────────────────────────────
console.log('\n— In the language the shop sells in —');
{
  for (const k of ['cookie.title', 'cookie.body', 'cookie.accept', 'cookie.reject', 'cookie.more', 'cookie.change']) {
    ok(`${k} has a Dutch translation`, new RegExp(`'${k}':\\s*'`).test(i18n));
  }
  const body = i18n.match(/'cookie\.body':\s*'([^']*)'/)?.[1] || '';
  ok('the Dutch text names what is always stored', /winkelwagen|ingelogd/.test(body), body.slice(0, 60));
  ok('…and says the shop works either way', /werkt hoe dan ook|aan jou/.test(body), body.slice(0, 60));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
