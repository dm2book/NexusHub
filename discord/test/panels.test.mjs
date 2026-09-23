/**
 * The pinned panels are the most-read messages on the server — and until now the
 * only way to correct one was to delete and re-pin every panel by hand.
 * These checks cover what that costs when it goes wrong.
 */
import { readFileSync } from 'node:fs';
import {
  buildPanels, panelNeedsUpdate, linkChannels,
  PANEL_FOOTER, isPanelFooter, panelFooterIsStale,
  rolesPanelComponents, languagePickerRow, hasLanguagePicker, LANGUAGE_PICKER_ID,
} from '../src/panels.js';
import { CATEGORIES, FAQ, LANGUAGE_ROLES, GAME_ROLES, NOTIFY_ROLES } from '../src/config.js';

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

console.log('\n— What the panels are signed with —');
{
  /* Every pinned panel carried the footer `forgemarket-setup` — the name of
     the script that posted it, in small grey type under the welcome message,
     the rules, the price list and the support panel. It could not simply be
     deleted: that string is also how setup.js and the bot's copy sync find
     their own panels among other messages in a channel. */
  ok('the footer is something a member can read', /forgemarket\.nl/i.test(PANEL_FOOTER));
  ok('…and is not the name of a script', !/setup|script|marker/i.test(PANEL_FOOTER));

  ok('a panel signed with the new footer is recognised', isPanelFooter(PANEL_FOOTER));
  /* The panels already pinned on the live server carry the old string. If that
     stopped being recognised, every one of them would be posted a second time
     instead of edited. */
  ok('…and so is one already on the server with the old marker', isPanelFooter('forgemarket-setup'));
  ok('but somebody else\'s footer is not', !isPanelFooter('something else') && !isPanelFooter(undefined));

  /* Two separate questions, deliberately. Folding the footer into
     panelNeedsUpdate would have made "identical copy does not churn the API"
     false for every panel on the server. */
  const same = { title: 'T', description: 'D', footer: { text: PANEL_FOOTER } };
  ok('an up-to-date panel needs no copy edit', !panelNeedsUpdate(same, { title: 'T', description: 'D' }));
  ok('…and no footer edit either', !panelFooterIsStale(same));

  const old = { title: 'T', description: 'D', footer: { text: 'forgemarket-setup' } };
  ok('a panel still carrying the old marker is rewritten once',
    panelFooterIsStale(old));
  ok('…even though its copy has not changed',
    !panelNeedsUpdate(old, { title: 'T', description: 'D' }));
  ok('…and once rewritten it is left alone',
    !panelFooterIsStale({ ...old, footer: { text: PANEL_FOOTER } }));
}

/**
 * The controls under #roles.
 *
 * These are raw Discord component objects rather than discord.js builders, so
 * nothing in the library is checking the shape for us. That is the trade this
 * module makes to stay testable, and this is the other half of it: the shape
 * is asserted here, and round-tripped through discord.js itself when it is
 * installed.
 */
console.log('\n— The #roles controls —');
{
  const rows = rolesPanelComponents();
  ok('Discord takes at most five rows', rows.length <= 5, `${rows.length} rows`);
  ok('every row is an action row', rows.every((r) => r.type === 1));
  ok('no row holds more than five buttons',
    rows.every((r) => r.components.length <= 5),
    rows.map((r) => r.components.length).join(', '));

  const select = rows[0].components[0];
  ok('the language picker comes first', select.type === 3 && select.custom_id === LANGUAGE_PICKER_ID);
  ok('…and offers exactly the four languages',
    JSON.stringify(select.options.map((o) => o.value)) === JSON.stringify(LANGUAGE_ROLES.map((l) => l.key)),
    select.options.map((o) => o.value).join(', '));
  /* One at a time. max_values: 2 would hand somebody two rooms, which is the
     one thing the gate in permissions.js exists to prevent. */
  ok('…and lets you pick exactly one',
    select.min_values === 1 && select.max_values === 1);
  ok('…and every option fits Discord\u2019s limits',
    select.options.every((o) => o.label.length <= 100 && (o.description || '').length <= 100
      && o.emoji?.name));
  /* The picker is read by people who do not read Dutch. */
  ok('the placeholder is not in one language only', /taal[\s\S]*language/i.test(select.placeholder),
    select.placeholder);

  const buttons = rows.slice(1).flatMap((r) => r.components);
  const keys = [...GAME_ROLES, ...NOTIFY_ROLES].map((r) => r.key);
  ok('every toggle is still there', buttons.length === keys.length, `${buttons.length} of ${keys.length}`);
  ok('…and each one carries a real role key',
    buttons.every((b) => keys.includes(String(b.custom_id).replace('role:', ''))),
    buttons.map((b) => b.custom_id).join(', '));
}

console.log('\n— Repairing a panel that predates the picker —');
{
  ok('a freshly built panel already has it', hasLanguagePicker(rolesPanelComponents()));
  /* The shape a message fetched from Discord arrives in: discord.js wraps each
     component and renames custom_id. Reading only one of the two spellings is
     how the repair either never fires or fires on every boot forever. */
  ok('…and so does one read back through discord.js\u2019s own field name',
    hasLanguagePicker([{ components: [{ customId: LANGUAGE_PICKER_ID }] }]));
  ok('…and through a builder\u2019s .data', hasLanguagePicker([{ components: [{ data: { custom_id: LANGUAGE_PICKER_ID } }] }]));
  // The panel as it stands on a server built before any of this existed.
  ok('the old button-only panel is seen as needing it',
    !hasLanguagePicker([{ components: [{ customId: 'role:robux' }, { customId: 'role:deals' }] }]));
  ok('an empty message is handled', !hasLanguagePicker([]) && !hasLanguagePicker());
}

console.log('\n— Something answers the picker —');
{
  /* A picker posted with nothing listening is a control that greys out and
     says "interaction failed" — worse than not offering it. */
  const bot = readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8');
  ok('bot.js routes the picker\u2019s id', bot.includes('LANGUAGE_PICKER_ID'));
  ok('…to a handler that exists', /async function setLanguage\(/.test(bot));
  ok('…and repairs the panel at boot', /syncRolesControls\(g\)/.test(bot));
}

console.log('\n— discord.js accepts the shape —');
{
  let ActionRowBuilder = null;
  try { ({ ActionRowBuilder } = await import('discord.js')); } catch { /* not installed */ }
  if (!ActionRowBuilder) {
    console.log('  ⏭  discord.js not installed — skipping the round-trip');
  } else {
    let threw = '';
    try {
      for (const r of rolesPanelComponents()) ActionRowBuilder.from(r).toJSON();
      ActionRowBuilder.from(languagePickerRow()).toJSON();
    } catch (e) { threw = e.message; }
    ok('every row survives discord.js\u2019s own builder', threw === '', threw);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
