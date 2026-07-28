/**
 * The pinned panels are the most-read messages on the server — and until now the
 * only way to correct one was to delete and re-pin every panel by hand.
 * These checks cover what that costs when it goes wrong.
 */
import { buildPanels, panelNeedsUpdate, linkChannels } from '../src/panels.js';
import { CATEGORIES, FAQ } from '../src/config.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const CHANNEL_NAMES = CATEGORIES.flatMap((c) => c.channels).map((c) => c.name);
const ids = Object.fromEntries(CHANNEL_NAMES.map((n, i) => [n, String(100000000000000000 + i)]));
const panels = buildPanels({ storeUrl: 'https://forgemarket.nl', guildName: 'ForgeMarket', channelIdByName: ids });

console.log('— Panel copy —');

// Discord renders <#name> as literal text; only <#id> becomes a link.
{
  const leftovers = Object.entries(panels)
    .filter(([, p]) => /<#[a-z][a-z0-9-]*>/i.test(`${p.title} ${p.description}`))
    .map(([n]) => n);
  ok('no unresolved <#channel-name> placeholders survive', leftovers.length === 0, leftovers.join(', '));
  ok('resolved references became real mentions', /<#\d{17,}>/.test(panels.welcome.description));
  ok('an unknown channel degrades to plain #name', linkChannels('go to <#nope>', ids) === 'go to #nope');
}

// Every panel placeholder must point at a channel that actually gets created.
{
  const referenced = new Set();
  for (const p of Object.values(panels)) {
    for (const m of `${p.title} ${p.description}`.matchAll(/<#(\d{17,})>/g)) referenced.add(m[1]);
  }
  const known = new Set(Object.values(ids));
  const dangling = [...referenced].filter((id) => !known.has(id));
  ok('no panel links to a channel that is never created', dangling.length === 0, dangling.join(', '));
}

// {STORE_URL} must never reach a member's screen.
{
  const raw = Object.entries(panels).filter(([, p]) => /\{STORE_URL\}/.test(`${p.title} ${p.description} ${p.image || ''}`)).map(([n]) => n);
  ok('no raw {STORE_URL} placeholder is left', raw.length === 0, raw.join(', '));
}

// Honesty policy: the storefront stopped making these claims, the server must too.
{
  const offenders = Object.entries(panels)
    .filter(([, p]) => /instant delivery|delivered in seconds|24\/7 support|under 10 minutes/i.test(`${p.title} ${p.description}`))
    .map(([n]) => n);
  ok('no panel promises instant delivery or 24/7 support', offenders.length === 0, offenders.join(', '));

  const faqText = FAQ.map((f) => `${f.q} ${f.a}`).join(' ');
  ok('the FAQ does not claim card checkout', !/card payment|secure card/i.test(faqText));
  ok('the FAQ explains the reference-based payment', /reference/i.test(faqText));
}

// A panel with no channel to live in is dead copy; a channel with no panel is an
// empty room. Both look broken to a visitor.
{
  const panelNames = Object.keys(panels);
  const orphanPanels = panelNames.filter((n) => !CHANNEL_NAMES.includes(n));
  ok('every panel has a channel to be posted in', orphanPanels.length === 0, orphanPanels.join(', '));
}

// Discord hard limits — exceeding one makes the send throw and the panel vanish.
{
  const tooLong = Object.entries(panels).filter(([, p]) => (p.description || '').length > 4096).map(([n]) => n);
  ok('no panel exceeds the 4096-char embed description limit', tooLong.length === 0, tooLong.join(', '));
  const titleTooLong = Object.entries(panels).filter(([, p]) => (p.title || '').length > 256).map(([n]) => n);
  ok('no panel title exceeds 256 chars', titleTooLong.length === 0, titleTooLong.join(', '));
}

// Trustpilot: the #links panel is the anti-scam reference ("if it isn't here,
// it isn't us"), so a link to a profile that does not exist yet is worse than
// no link at all. The whole feature is therefore conditional, both ways.
console.log('\n— Trustpilot —');
{
  const TP = 'https://nl.trustpilot.com/review/forgemarket.nl';
  const withTp = buildPanels({ storeUrl: 'https://forgemarket.nl', channelIdByName: ids, trustpilotUrl: TP });

  ok('unset: the links panel says nothing about Trustpilot', !/trustpilot/i.test(panels.links.description));
  ok('unset: the reviews panel says nothing about Trustpilot', !/trustpilot/i.test(panels.reviews.description));
  const anyMention = Object.entries(panels).filter(([, p]) => /trustpilot/i.test(`${p.title} ${p.description}`)).map(([n]) => n);
  ok('unset: no panel at all mentions it', anyMention.length === 0, anyMention.join(', '));

  ok('set: the links panel carries the real URL', withTp.links.description.includes(TP));
  ok('set: the reviews panel carries the real URL', withTp.reviews.description.includes(TP));
  ok('set: the links panel keeps every other official link',
    ['/shop', '/track', '/account'].every((p) => withTp.links.description.includes(`https://forgemarket.nl${p}`)));
  ok('set: still no raw placeholder leaks',
    !/\{[A-Z_]+\}/.test(`${withTp.links.description} ${withTp.reviews.description}`));
  ok('whitespace-only value counts as unset',
    !/trustpilot/i.test(buildPanels({ storeUrl: 'https://forgemarket.nl', trustpilotUrl: '   ' }).links.description));
  ok('set: descriptions stay inside the 4096-char embed limit',
    Object.values(withTp).every((p) => (p.description || '').length <= 4096));
}

console.log('\n— Copy sync —');
{
  ok('a changed description triggers an update',
    panelNeedsUpdate({ title: 'T', description: 'old' }, { title: 'T', description: 'new' }));
  ok('a changed title triggers an update',
    panelNeedsUpdate({ title: 'old', description: 'D' }, { title: 'new', description: 'D' }));
  ok('identical copy does not', !panelNeedsUpdate({ title: 'T', description: 'D' }, { title: 'T', description: 'D' }));
  ok('whitespace-only differences do not churn the API',
    !panelNeedsUpdate({ title: 'T ', description: 'a  b\n' }, { title: 'T', description: 'a b' }));
  // The banner sync owns the image; a copy sync must not fight it.
  ok('an image difference alone is not a copy change',
    !panelNeedsUpdate({ title: 'T', description: 'D', image: { url: 'a.png' } }, { title: 'T', description: 'D', image: 'b.png' }));
  ok('a missing embed is handled', !panelNeedsUpdate(undefined, { title: 'T', description: 'D' }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
