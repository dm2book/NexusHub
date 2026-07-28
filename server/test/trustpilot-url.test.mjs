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
const shopFor = async (value) => {
  if (value === undefined) delete process.env.TRUSTPILOT_URL;
  else process.env.TRUSTPILOT_URL = value;
  const mod = await import(`../src/config/env.js?tp=${encodeURIComponent(String(value))}`);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
