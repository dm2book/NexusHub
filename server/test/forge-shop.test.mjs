/**
 * The Forge Shop page, and the numbers it is allowed to put on screen.
 *
 * It showed a balance and four cards. Everything else a member wants to know —
 * how much they have earned, how far off the next reward is, which reward is
 * actually the best value — was either absent or asserted in prose.
 *
 * Adding those meant deciding where each number comes from, and two of them
 * have a wrong answer that looks right:
 *
 *   · LIFETIME TOTALS. `history` is the most recent twenty rows. Summing it
 *     gives a total that is correct for a new member and quietly wrong for
 *     everyone else — wrong in the flattering direction, because the oldest
 *     rows are the ones that drop off. They are two SUMs over the whole ledger.
 *   · THE EARN RATE. "1 coin per €10" is a pricing decision living in one
 *     constant. A page that writes it out in its own words is a second copy
 *     that goes stale silently the day the constant moves.
 *
 * And one that was prose: the €25 card's blurb says "best value". Now the badge
 * is worked out from cost and value, so it cannot disagree with the numbers
 * printed beside it — and it follows along if the owner adds an item.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../src/utils/crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* Comments stripped: this file explains its own fixes by quoting what it
   replaced, and a grep over the raw source fails on the explanation. */
const pageSrc = readFileSync(join(ROOT, 'src/pages/account/ForgeShop.jsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { requestEmailOtp } = await import('../src/services/authService.js');
const { coinTotals, coinHistory, FORGE_SHOP, COINS_PER_EURO_CENTS } =
  await import('../src/services/forgeCoinService.js');
const { run, get } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const email = 'mohamedelhannouti51@gmail.com';
await requestEmailOtp(email, {});
const otp = await get(
  `SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: otp.id });
const login = await (await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) })).json();
const auth = { authorization: `Bearer ${login.accessToken}` };
ok('the member signs in', !!login.accessToken);
const user = await get('SELECT id FROM users WHERE email=@e', { e: email });

const ledger = async (delta, reason, ref, daysAgo) => run(
  `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
   VALUES (@id, @u, @d, @r, @ref, @at)`,
  { id: newId('fcl'), u: user.id, d: delta, r: reason, ref,
    at: new Date(Date.now() - daysAgo * 86_400_000).toISOString() });

console.log('\n— Lifetime totals are not the visible history added up —');
{
  await run('DELETE FROM forge_coin_ledger WHERE user_id=@u', { u: user.id });
  /* Twenty-five earns and one spend. coinHistory returns twenty rows, so a page
     summing what it can see would report 20 earned; the truth is 25. */
  for (let i = 0; i < 25; i++) await ledger(1, 'order', `ord-${i}`, 40 - i);
  await ledger(-8, 'redeem', 'FORGETEST1', 1);

  const totals = await coinTotals(user.id);
  const visible = await coinHistory(user.id);
  ok('the history is capped', visible.length === 20, String(visible.length));
  ok('the totals count the whole ledger', totals.earned === 25, JSON.stringify(totals));
  ok('…and the spend too', totals.spent === 8);
  const fromVisible = visible.filter((h) => h.delta > 0).reduce((a, h) => a + h.delta, 0);
  ok('…which is NOT what the visible rows add up to', fromVisible !== totals.earned,
    `${fromVisible} visible vs ${totals.earned} real`);
  ok('…and the difference flatters, which is why it matters',
    fromVisible < totals.earned, `${fromVisible} < ${totals.earned}`);

  const r = await (await fetch(`${base}/api/account/coins`, { headers: auth })).json();
  ok('the endpoint carries them', r.totals?.earned === 25 && r.totals?.spent === 8,
    JSON.stringify(r.totals));
  ok('and the balance still comes from the ledger', r.balance === 17, String(r.balance));
}

console.log('\n— The earn rate travels with the payload —');
{
  const r = await (await fetch(`${base}/api/account/coins`, { headers: auth })).json();
  ok('the rate is sent', r.perCoinCents === COINS_PER_EURO_CENTS, String(r.perCoinCents));
  ok('and the page reads it rather than writing it out',
    /perCoinCents/.test(pageSrc), 'the page must not hardcode the rate');
  /* The specific thing that goes stale: the old copy said "1 coin for every
     €10" in prose, so changing COINS_PER_EURO_CENTS would have left the page
     confidently quoting the old rate. */
  ok('…so no euro amount is typed into the earn sentence',
    !/1 coin for every €10|per €10/.test(pageSrc), 'the rate is hardcoded somewhere');
}

console.log('\n— Best value is worked out, not claimed —');
{
  const priced = FORGE_SHOP.filter((r) => r.kind === 'coupon' && r.value > 0);
  const best = priced.reduce((a, b) => (b.value / b.cost > a.value / a.cost ? b : a));
  /* €25/65 = 38.5c per coin, €10/28 = 35.7c, €5/15 = 33.3c. The prose in the
     €25 blurb happens to be right today; the badge is computed so it cannot
     stop being right without the number changing too. */
  ok('the €25 code really is the best value per coin', best.id === 'coupon25',
    `${best.id} at ${(best.value / best.cost).toFixed(1)}c/coin`);
  ok('the page derives it from cost and value',
    /bestValueId/.test(pageSrc) && /value \/ b?\.?cost|value \/ a\.cost/.test(pageSrc),
    'the badge must not be hardcoded to an id');
  ok('…and no reward id is written into the badge',
    !/coupon25['"]?\s*===|===\s*['"]coupon25/.test(pageSrc));
  /* A giveaway boost has no euro value. Counting it as 0 would make it the
     worst by arithmetic on a quantity it does not have. */
  ok('rewards with no euro value are left out, not scored zero',
    /kind === 'coupon'/.test(pageSrc) && /r\.value > 0/.test(pageSrc));
}

console.log('\n— The distance is stated in what it takes to close it —');
{
  ok('the page converts coins to spend', /spendToReach/.test(pageSrc));
  ok('…using the rate from the payload, not a constant',
    /perCoin\b/.test(pageSrc) && !/\* 10\b/.test(pageSrc.split('spendToReach')[1] || ''),
    'the conversion must use the sent rate');
  /* 19 coins against a 65-coin reward is 46 coins away, which at €10 a coin is
     €460 of spending. That is the number a shopper can act on; "46 to go" is
     not. */
  const away = (65 - 19) * (COINS_PER_EURO_CENTS / 100);
  ok('…which for the €25 code at 19 coins is €460', away === 460, String(away));
}

console.log('\n— And the page says nothing it cannot back —');
{
  ok('the balance comes from the payload', /data\.balance|data\?\.balance/.test(pageSrc));
  ok('an empty ledger is explained rather than left blank', /No coins yet/.test(pageSrc));
  ok('a ledger entry is dated by the day, not to the second',
    /dateShort\(h\.createdAt\)/.test(pageSrc), 'seconds on a coin ledger are noise');
  ok('the loud gradient panel is gone',
    !/f59e0b|f43f5e/.test(pageSrc), 'the orange-to-pink header belonged to no other surface');
}

srv.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} forge-shop: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
