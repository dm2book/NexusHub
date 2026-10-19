/**
 * One look for every Discord message, inside Discord's limits.
 *
 * The bot built ~50 embeds by hand with fourteen colours for four meanings,
 * footers on some and not others, and nothing between a long product name or
 * review and Discord's size limits — discord.js throws on a 257-character
 * title, so that message was never sent. The store's own embeds (drops,
 * reviews, DMs) were a second, separate set of hand-built objects.
 *
 * This checks the shared style (discord/src/embedStyle.js + palette.js on the
 * bot, server/src/services/discordStyle.js on the store), that nothing builds
 * an embed around it, the limits, the one-emoji titles, and the buttons that
 * carry each message's one action.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const EMOJI = /\p{Extended_Pictographic}(?:️|⃣)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu;
const emojiCount = (s) => (String(s ?? '').match(EMOJI) || []).length;
const total = (e) => (e.title?.length || 0) + (e.description?.length || 0) + (e.footer?.text?.length || 0)
  + (e.author?.name?.length || 0) + (e.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);

/* A stand-in Discord webhook, so the store's own posts can be captured. */
const captured = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { captured.push(JSON.parse(b || '{}')); res.writeHead(204); res.end(); });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const hook = `http://127.0.0.1:${srv.address().port}/hook`;
Object.assign(process.env, {
  NODE_ENV: 'development', APP_URL: 'https://www.forgemarket.nl',
  DISCORD_DROPS_WEBHOOK_URL: hook, DISCORD_REVIEWS_WEBHOOK_URL: hook,
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/fmt_de_style',
});

const bot = read(join(ROOT, 'src/bot.js'));
const svc = read(join(REPO, 'server/src/services/discordService.js'));
const wish = read(join(REPO, 'server/src/services/wishlistService.js'));

console.log('— One style, on both sides —');
const styleMod = existsSync(join(ROOT, 'src/embedStyle.js')) ? await import('../src/embedStyle.js') : {};
const serverStyle = existsSync(join(REPO, 'server/src/services/discordStyle.js'))
  ? await import('../../server/src/services/discordStyle.js') : {};
ok('the bot has a shared embed style', typeof styleMod.styled === 'function');
ok('the store has the same palette as the bot',
  !!styleMod.PALETTE && JSON.stringify(styleMod.PALETTE) === JSON.stringify(serverStyle.PALETTE),
  JSON.stringify([styleMod.PALETTE, serverStyle.PALETTE]));
ok('…and the same limits', !!styleMod.LIMITS && JSON.stringify(styleMod.LIMITS) === JSON.stringify(serverStyle.LIMITS));

console.log('\n— Nothing builds an embed around the style —');
ok('bot.js no longer constructs a bare EmbedBuilder', !/new EmbedBuilder\(/.test(bot),
  `${(bot.match(/new EmbedBuilder\(/g) || []).length} left`);
const botHex = bot.match(/0x[0-9a-fA-F]{6}\b/g) || [];
ok('bot.js has no colour of its own — every colour is the palette', botHex.length === 0, botHex.join(' '));
ok('bot.js tells the style its address and icon', /configureEmbedStyle\(\{ storeUrl: STORE_URL, icon: BRAND_ICON \}\)/.test(bot));
const svcHex = (svc + wish).match(/color: 0x[0-9a-fA-F]{6}/g) || [];
ok('the store\'s Discord embeds use the palette too', svcHex.length === 0, svcHex.join(' '));
ok('…built through brandEmbed()', (svc.match(/brandEmbed\(/g) || []).length >= 12 && /brandEmbed\(/.test(wish));

console.log('\n— A bot embed —');
if (styleMod.styled) {
  styleMod.configureEmbedStyle({ storeUrl: 'https://www.forgemarket.nl', icon: 'https://www.forgemarket.nl/icon-512.png' });
  const e = styleMod.styled('success').setTitle('🎉 Hoi 🎁 daar ✅').setDescription('Klaar.').toJSON();
  ok('carries the palette colour for its state', e.color === styleMod.PALETTE.success);
  ok('…the shop footer with its icon', /^ForgeMarket · www\.forgemarket\.nl$/.test(e.footer?.text || '') && !!e.footer?.icon_url, JSON.stringify(e.footer));
  ok('…a timestamp', !!e.timestamp);
  ok('…and at most one emoji in the title', emojiCount(e.title) === 1, e.title);
  const f = styleMod.styled('info').setFooter({ text: 'verwijzingen' }).toJSON();
  ok('a custom footer keeps the shop name in front', f.footer.text === 'ForgeMarket · verwijzingen', f.footer.text);

  let built = null, threw = null;
  try {
    built = styleMod.styled('info')
      .setTitle('x'.repeat(400)).setDescription('y'.repeat(5000))
      .setAuthor({ name: 'a'.repeat(400) }).setFooter({ text: 'f'.repeat(3000) })
      .addFields(...Array.from({ length: 30 }, (_, n) => ({ name: `n${n}`.repeat(100), value: 'v'.repeat(2000) })))
      .toJSON();
  } catch (err) { threw = err.message; }
  ok('oversized input is trimmed instead of throwing', !!built && !threw, threw || '');
  if (built) {
    ok('…title ≤ 256, description ≤ 4096, author ≤ 256, footer ≤ 2048',
      built.title.length <= 256 && built.description.length <= 4096 && built.author.name.length <= 256 && built.footer.text.length <= 2048);
    ok('…at most 25 fields, each name ≤ 256 and value ≤ 1024',
      built.fields.length <= 25 && built.fields.every((x) => x.name.length <= 256 && x.value.length <= 1024));
    ok('…and the whole embed ≤ 6000 characters', total(built) <= 6000, String(total(built)));
  }
}

console.log('\n— Titles —');
const titleLits = [...bot.matchAll(/setTitle\((['`])([^'`]*)\1\)/g)].map((m) => m[2]);
const bad = titleLits.filter((t) => emojiCount(t) > 1);
ok(`every literal bot title has at most one emoji (${titleLits.length} checked)`, bad.length === 0, bad.join(' | '));
ok('no SHOUTING titles on public posts', !/setTitle\('[^']*(FLASH SALE|GIVEAWAY)[^']*'\)/.test(bot));

console.log('\n— /order: the one thing to do next, as the button —');
const OS = await import('../src/orderStatus.js');
if (styleMod.orderStatusMessage) {
  const track = 'https://www.forgemarket.nl/track?number=FM-2026-AAAA1111';
  const pending = styleMod.orderStatusMessage(OS.orderStatusView({ number: 'FM-2026-AAAA1111', status: 'pending' },
    { lang: 'nl', provider: 'paynl' }), { trackUrl: track });
  const btn = pending.components[0]?.toJSON().components[0] || {};
  ok('unpaid under Pay.: the button says to pay and goes to the order page', btn.label === 'Betaal je bestelling' && btn.url === track, JSON.stringify(btn));
  const done = styleMod.orderStatusMessage(OS.orderStatusView({ number: 'FM-2026-AAAA1111', status: 'completed' },
    { lang: 'nl', provider: 'paynl' }), { trackUrl: track });
  ok('delivered: the button is the live status page', done.components[0]?.toJSON().components[0]?.label === 'Live statuspagina');
  ok('the order embed carries the shop footer', /^ForgeMarket · /.test(done.embeds[0].toJSON().footer.text));
} else ok('the /order message is built by the shared style', false);
ok('a refund promises no number of days', !/1–3|1 à 3/.test(read(join(ROOT, 'src/orderStatus.js'))));

console.log('\n— The store\'s messages —');
const D = await import('../../server/src/services/discordService.js');
if (D.paymentReminderMessage) {
  const m = D.paymentReminderMessage({ orderNumber: 'FM-2026-AAAA1111', amount: '€ 9,99', lang: 'nl', provider: 'paynl' });
  const b = m.components?.[0]?.components?.[0] || {};
  ok('payment reminder under Pay.: a pay button to /track', b.label === 'Betaal je bestelling'
    && b.url === 'https://www.forgemarket.nl/track?number=FM-2026-AAAA1111', JSON.stringify(b));
  ok('…no bank-transfer wording', !/Maak het exacte bedrag over/.test(m.embeds[0].description));
  ok('…in the shop style', m.embeds[0].color === serverStyle.PALETTE?.warning && /^ForgeMarket · /.test(m.embeds[0].footer.text));
} else ok('payment reminder is a full message with a button', false);

if (serverStyle.brandEmbed) {
  const big = serverStyle.brandEmbed('info', { title: `🆕 ${'Robux 🎮 '.repeat(60)}`, description: 'd'.repeat(5000),
    fields: Array.from({ length: 30 }, () => ({ name: 'x', value: 'v'.repeat(1500) })) });
  ok('store embeds respect every limit', big.title.length <= 256 && big.description.length <= 4096
    && big.fields.length <= 25 && big.fields.every((x) => x.value.length <= 1024) && total(big) <= 6000, String(total(big)));
  ok('…and keep one emoji in a title', emojiCount(big.title) === 1, big.title.slice(0, 60));
}

await D.postDropEvent('product', { id: 'prd_x', name: '1,000 Robux', price: 999, currency: 'EUR', category: 'robux' });
await new Promise((r) => setTimeout(r, 200));
const drop = captured[0];
ok('a drop through a plain webhook carries no buttons (a webhook cannot send them)', !!drop && !drop.components, JSON.stringify(Object.keys(drop || {})));
ok('…its button becomes a link in the text instead', /\[Bekijk het product\]\(https:\/\/www\.forgemarket\.nl\/product\/prd_x\)/.test(drop?.embeds?.[0]?.description || ''),
  drop?.embeds?.[0]?.description);
ok('…in Dutch, with a Dutch price', /Nieuw/.test(drop?.embeds?.[0]?.title || '') && /€\s?9,99/.test(drop?.embeds?.[0]?.description || ''),
  drop?.embeds?.[0]?.description);

srv.close();
console.log(`\n${fail ? '❌' : '✅'} embed-style: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
