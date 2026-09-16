/**
 * A redrawn banner has to actually reach the server.
 *
 * Every panel embeds its banner by URL — `{STORE_URL}/discord/banner-x.png?v=2`
 * — and Discord caches what it fetches at that URL essentially forever. So
 * redrawing the artwork changes nothing a member sees: the embed keeps pointing
 * at a URL Discord already has, and the old picture stays on the server. The
 * `?v=` was there for exactly this, and it was a hand-typed `2` on all eight,
 * which means it is one thing to remember at the one moment you are least
 * likely to: after the redraw, when the work looks finished.
 *
 * So the version is the artwork's own sha. Nothing to remember — a banner that
 * changes gets a new URL by construction, and this test is what says so out
 * loud when the two drift.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/* Comments stripped, the way honest-copy.test reads a file: two of these
   modules explain in prose what the URL used to look like, and a prose
   mention of /discord/banner-undefined.png is not a second copy of the URL. */
const codeOf = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const sha8 = (file) => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex').slice(0, 8);

console.log('— Every banner the server shows points at the bytes on disk —');
{
  /* Read off the map, not off the call sites — the whole point of the map is
     that there are no other call sites. There were three: the panels in
     discord/src/config.js on `?v=2`, bot.js with its own BANNER() helper also
     on `?v=2`, and the server's drop announcements with no version at all and
     a `.png` that no longer exists. */
  const { bannerUrl, BANNER_VERSION } = await import(join(ROOT, 'src/lib/discordBanners.js'));
  const refs = Object.keys(BANNER_VERSION).map((name) => {
    const m = bannerUrl(name, '').match(/discord\/(banner-[a-z-]+\.(?:jpg|png))(?:\?v=([a-z0-9]+))?/);
    return { name, file: m?.[1], version: m?.[2] || null };
  });
  ok(`${refs.length} banners, all built from one version map`, refs.length >= 8, `${refs.length}`);

  /* The bot's Docker image copies only discord/, so that tree keeps its own
     copy of the map. A duplicate is only safe while something checks it. */
  const bot = await import(join(ROOT, 'discord/src/config.js'));
  ok('the bot ships the same versions it cannot import',
    JSON.stringify(bot.BANNER_VERSION) === JSON.stringify(BANNER_VERSION),
    `bot: ${JSON.stringify(bot.BANNER_VERSION)}`);
  ok('…and builds the same URL from them',
    bot.bannerImage('deals') === bannerUrl('deals', '{STORE_URL}'),
    `${bot.bannerImage('deals')} vs ${bannerUrl('deals', '{STORE_URL}')}`);

  /* Nowhere else may spell one out. Every tree that announces to Discord is
     checked, because the one that was missed for months was the server's. */
  for (const f of ['discord/src/bot.js', 'discord/src/setup.js', 'server/src/services/discordService.js']) {
    ok(`${f} writes no banner URL of its own`,
      !/discord\/banner-[^'"`\s]*\.(?:png|jpg)/.test(codeOf(f)),
      'a second copy of the URL is a second version to forget');
  }

  const missing = [...new Set(refs.map((r) => r.file))]
    .filter((f) => !existsSync(join(ROOT, 'public/discord', f)));
  ok('every one of them exists', missing.length === 0, missing.join(', '));

  const unversioned = refs.filter((r) => !r.version).map((r) => r.file);
  ok('and every one carries a cache-busting version', unversioned.length === 0, unversioned.join(', '));

  const stale = refs.filter((r) => r.file && existsSync(join(ROOT, 'public/discord', r.file))
    && r.version !== sha8(`public/discord/${r.file}`));
  ok('…which is the artwork\'s own hash, so a redraw cannot be forgotten',
    stale.length === 0,
    stale.map((r) => `${r.file}: config says ?v=${r.version}, file is ${sha8(`public/discord/${r.file}`)}`).join(' | ')
      + ' — run node scripts/art/social-generate.mjs, then update BANNER_VERSION in discord/src/config.js');

  /* A hand-typed number is what this replaced, and it is the shape that
     silently stops working. */
  const handTyped = refs.filter((r) => /^\d{1,3}$/.test(r.version || '')).map((r) => r.file);
  ok('nothing is back on a hand-typed version number', handTyped.length === 0, handTyped.join(', '));
}

console.log('\n— …and so does the card on every shared link —');
{
  /* The same cache, a wider blast radius. Facebook, X and Discord keep a share
     card keyed on its URL, and the one they kept says "Digital goods,
     delivered instantly", "4.9/5" and "24/7 support" — three claims this shop
     retracted. og.png carried no version at all, so redrawing it would have
     changed nothing anyone sees. */
  const want = sha8('public/og.jpg');
  const FILES = ['index.html', 'src/content/seo.js', 'server/src/routes/seo.js'];
  for (const f of FILES) {
    const refs = [...read(f).matchAll(/og\.jpg(\?v=([a-z0-9]+))?(?=["'`\s])/g)];
    ok(`${f} points at the share card`, refs.length > 0);
    const stale = refs.filter((m) => m[2] !== want).length;
    ok(`…at the version that is on disk (${want})`, stale === 0,
      `${stale} of ${refs.length} reference(s) carry ${refs.map((m) => m[2] ?? '(none)').join(', ')}`);
  }
}

console.log('\n— The artwork can be redrawn at all —');
{
  const { BANNER_VERSION } = await import(join(ROOT, 'discord/src/config.js'));
  /* The four retired creatives shipped for months with the reason written
     down, because marking a PNG does not redraw it and nothing here could. */
  ok('there is a generator in the repo', existsSync(join(ROOT, 'scripts/art/social-generate.mjs')));
  const spec = read('scripts/art/social.mjs');
  ok('…and it draws every banner the panels use',
    Object.keys(BANNER_VERSION).map((n) => `banner-${n}.jpg`)
      .every((f) => spec.includes(f)),
    'a banner referenced by the server that the generator cannot draw is one that can never be corrected');
  ok('…and the link-preview card too', spec.includes('public/og.jpg'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} creative-freshness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
