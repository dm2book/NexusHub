/**
 * The Trustpilot link has to LEAVE the site.
 *
 * An <a href> without a scheme is a relative path, so pasting the URL as a
 * browser shows it — "nl.trustpilot.com/review/…" — would send a buyer to
 * forgemarket.nl/nl.trustpilot.com/…, our own 404, exactly when they went off
 * to check whether we can be trusted. The Discord bot normalizes its own copy,
 * so that mistake works in Discord and breaks only on the website: the hardest
 * kind to notice, which is why it is pinned here.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_trustpilot';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

// The module reads process.env once at import, so each case needs a fresh copy.
let bust = 0;
const shopFor = async (value, writeValue) => {
  if (value === undefined) delete process.env.TRUSTPILOT_URL;
  else process.env.TRUSTPILOT_URL = value;
  if (writeValue === undefined) delete process.env.TRUSTPILOT_REVIEW_URL;
  else process.env.TRUSTPILOT_REVIEW_URL = writeValue;
  const mod = await import(`../src/config/env.js?tp=${bust++}`);
  return mod.config.shop;
};

console.log('— Absolute, always —');
{
  const bare = await shopFor('nl.trustpilot.com/review/forgemarket.nl');
  ok('a pasted URL with no scheme becomes absolute',
    bare.trustpilotUrl === 'https://nl.trustpilot.com/review/forgemarket.nl', bare.trustpilotUrl);

  const full = await shopFor('https://nl.trustpilot.com/review/forgemarket.nl');
  ok('a complete URL is left alone',
    full.trustpilotUrl === 'https://nl.trustpilot.com/review/forgemarket.nl', full.trustpilotUrl);

  const slash = await shopFor('https://nl.trustpilot.com/review/forgemarket.nl/');
  ok('a trailing slash is trimmed',
    slash.trustpilotUrl === 'https://nl.trustpilot.com/review/forgemarket.nl', slash.trustpilotUrl);

  const spaced = await shopFor('  https://nl.trustpilot.com/review/forgemarket.nl  ');
  ok('stray whitespace from a copy-paste is trimmed',
    spaced.trustpilotUrl === 'https://nl.trustpilot.com/review/forgemarket.nl', spaced.trustpilotUrl);

  const insecure = await shopFor('http://nl.trustpilot.com/review/forgemarket.nl');
  ok('an explicit http:// is respected rather than silently rewritten',
    insecure.trustpilotUrl === 'http://nl.trustpilot.com/review/forgemarket.nl', insecure.trustpilotUrl);
}

console.log('\n— Unset stays unset —');
{
  // Every surface keys off falsiness to hide itself; anything non-empty here
  // would put a dead link in the anti-scam channel.
  const blank = await shopFor('');
  ok('an empty value stays empty', blank.trustpilotUrl === '', JSON.stringify(blank.trustpilotUrl));

  const ws = await shopFor('   ');
  ok('a whitespace-only value counts as unset', ws.trustpilotUrl === '', JSON.stringify(ws.trustpilotUrl));

  const missing = await shopFor(undefined);
  ok('a missing variable counts as unset', missing.trustpilotUrl === '', JSON.stringify(missing.trustpilotUrl));

  const slashOnly = await shopFor('/');
  ok('a lone slash does not become "https://"', slashOnly.trustpilotUrl === '', JSON.stringify(slashOnly.trustpilotUrl));
}

// Reading and writing are different jobs: a surface that ASKS for a review must
// open the form, because every click between the ask and the box costs reviews.
console.log('\n— Asking vs reading —');
{
  const nl = await shopFor('https://nl.trustpilot.com/review/forgemarket.nl');
  ok('the write link is the /evaluate/ form',
    nl.trustpilotReviewUrl === 'https://nl.trustpilot.com/evaluate/forgemarket.nl', nl.trustpilotReviewUrl);
  ok('the profile link is left as the profile',
    nl.trustpilotUrl === 'https://nl.trustpilot.com/review/forgemarket.nl', nl.trustpilotUrl);

  const www = await shopFor('https://www.trustpilot.com/review/forgemarket.nl');
  ok('any trustpilot subdomain works',
    www.trustpilotReviewUrl === 'https://www.trustpilot.com/evaluate/forgemarket.nl', www.trustpilotReviewUrl);

  const bare = await shopFor('nl.trustpilot.com/review/forgemarket.nl');
  ok('a scheme-less paste still derives correctly',
    bare.trustpilotReviewUrl === 'https://nl.trustpilot.com/evaluate/forgemarket.nl', bare.trustpilotReviewUrl);

  const explicit = await shopFor('https://nl.trustpilot.com/review/forgemarket.nl',
    'https://nl.trustpilot.com/evaluate/shop.forgemarket.nl');
  ok('an explicit TRUSTPILOT_REVIEW_URL wins over the derivation',
    explicit.trustpilotReviewUrl === 'https://nl.trustpilot.com/evaluate/shop.forgemarket.nl', explicit.trustpilotReviewUrl);

  const none = await shopFor('');
  ok('no profile means no write link either', none.trustpilotReviewUrl === '', JSON.stringify(none.trustpilotReviewUrl));
}

// A rewrite that guesses wrong is worse than no rewrite: the profile page
// always carries a "Write a review" button, so falling back costs one click,
// while a mangled path costs the review entirely.
console.log('\n— Never invent a path —');
{
  // "/review/" appears in the path but the host is not Trustpilot at all.
  const other = await shopFor('https://example.com/review/forgemarket');
  ok('a non-Trustpilot host is never rewritten',
    other.trustpilotReviewUrl === 'https://example.com/review/forgemarket', other.trustpilotReviewUrl);

  // A host that merely ENDS in something similar must not match.
  const lookalike = await shopFor('https://nottrustpilot.com/review/forgemarket');
  ok('a look-alike domain is never rewritten',
    lookalike.trustpilotReviewUrl === 'https://nottrustpilot.com/review/forgemarket', lookalike.trustpilotReviewUrl);

  // Already the form: leave it alone rather than mangling it.
  const already = await shopFor('https://nl.trustpilot.com/evaluate/forgemarket.nl');
  ok('a URL that is already the form is left alone',
    already.trustpilotReviewUrl === 'https://nl.trustpilot.com/evaluate/forgemarket.nl', already.trustpilotReviewUrl);

  // Trustpilot, but some other page — no /review/ to swap.
  const odd = await shopFor('https://nl.trustpilot.com/categories/gaming');
  ok('an unrecognised Trustpilot path falls back to itself',
    odd.trustpilotReviewUrl === 'https://nl.trustpilot.com/categories/gaming', odd.trustpilotReviewUrl);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
