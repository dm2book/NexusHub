/**
 * A reward the shop sold and nothing could deliver.
 *
 * The Forge Shop sells a "Giveaway boost" for 8 coins — "+1 bonus entry in this
 * week's giveaway (claim in Discord)". Redeeming it debited the coins, wrote a
 * ledger row, and returned. Nothing else happened anywhere:
 *
 *   · there is no command in Discord to claim it;
 *   · nobody is told it was bought;
 *   · and the giveaway keeps its entrants in a Set of user ids, so ONE extra
 *     entry is not representable — not by the bot, and not by a staff member
 *     trying to honour it by hand.
 *
 * So eight coins bought nothing at all. This is about the parts that make it a
 * real thing: a row, a claim that is safe to retry, and a draw that reaches
 * into a pool rather than a set of people.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const {
  redeemReward, openBoosts, claimBoosts, coinProgress, coinBalance, FORGE_SHOP,
} = await import('../src/services/forgeCoinService.js');
const { run, get, all } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

const mkUser = async (email) => {
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, created_at, updated_at)
             VALUES (@id, @e, @at, @at)`, { id, e: email, at: new Date().toISOString() });
  return id;
};
const grant = (userId, n) => run(
  `INSERT INTO forge_coin_ledger (id, user_id, delta, reason, ref, created_at)
   VALUES (@id, @u, @d, 'order', @ref, @at)`,
  { id: newId('fcl'), u: userId, d: n, ref: newId('ord'), at: new Date().toISOString() });

console.log('\n— Buying a boost creates something —');
const buyer = await mkUser(`boost-${Date.now()}@example.test`);
{
  await grant(buyer, 20);
  ok('nothing held before buying', await openBoosts(buyer) === 0);
  const out = await redeemReward(buyer, 'boost');
  ok('the redemption succeeds', !!out.reward);
  /* The whole defect in one assertion: this used to return with the coins gone
     and no record of the thing anywhere. */
  ok('…and a boost now exists', !!out.boostId, JSON.stringify(out));
  ok('…held by the buyer', await openBoosts(buyer) === 1);
  ok('the coins really were spent',
    await coinBalance(buyer) === 20 - FORGE_SHOP.find((r) => r.id === 'boost').cost);
  ok('it carries no coupon code, because a boost is not a coupon', !out.couponCode);
}

console.log('\n— Claiming it against a draw —');
{
  const claimed = await claimBoosts([buyer], 'gw-msg-1');
  ok('the entrant gets one extra entry', claimed[buyer] === 1, JSON.stringify(claimed));
  ok('…and it is no longer held', await openBoosts(buyer) === 0);
  const row = await get(`SELECT consumed_ref FROM giveaway_boosts WHERE user_id=@u`, { u: buyer });
  ok('…stamped with the giveaway it was spent on', row?.consumed_ref === 'gw-msg-1');
}

console.log('\n— A draw that is retried does not eat a second boost —');
{
  const again = await claimBoosts([buyer], 'gw-msg-1');
  /* A bot that reconnects mid-draw asks again. Without the stamp it would
     consume the buyer's NEXT boost, or hand them nothing while having taken
     one — both wrong, and invisible. */
  ok('the same giveaway returns what it already claimed', again[buyer] === 1, JSON.stringify(again));
  ok('…without consuming anything else', await openBoosts(buyer) === 0);

  await grant(buyer, 10);
  await redeemReward(buyer, 'boost');
  ok('a newly bought boost is held again', await openBoosts(buyer) === 1);
  const third = await claimBoosts([buyer], 'gw-msg-1');
  ok('…and the retried draw still does not take it', third[buyer] === 1 && await openBoosts(buyer) === 1,
    JSON.stringify(third));
  const other = await claimBoosts([buyer], 'gw-msg-2');
  ok('but a DIFFERENT giveaway does', other[buyer] === 1 && await openBoosts(buyer) === 0);
}

console.log('\n— Entrants without a boost are simply absent —');
{
  const plain = await mkUser(`plain-${Date.now()}@example.test`);
  const out = await claimBoosts([plain, buyer], 'gw-msg-3');
  ok('nobody is invented a boost they did not buy', out[plain] === undefined, JSON.stringify(out));
  ok('…and neither is the buyer, now that theirs are spent', out[buyer] === undefined);
  ok('an empty draw claims nothing',
    JSON.stringify(await claimBoosts([], 'gw-msg-4')) === '{}');
  ok('a draw with no id claims nothing',
    JSON.stringify(await claimBoosts([buyer], '')) === '{}');
}

console.log('\n— One computation for the website and the bot —');
{
  const fresh = await mkUser(`prog-${Date.now()}@example.test`);
  await grant(fresh, 19);
  const p = await coinProgress(fresh);
  ok('the balance is there', p.balance === 19);
  ok('the earn rate travels with it', p.perCoinCents === 1000);
  ok('the next reward is the cheapest one out of reach',
    p.next?.id === 'coupon10' && p.next.coinsAway === 9, JSON.stringify(p.next));
  /* "9 to go" is a number nobody can act on. Nine coins at €10 each is €90 of
     spending, which is the same fact in the currency a shopper thinks in. */
  ok('…with the distance in spending', p.next.spendAwayCents === 9000, String(p.next.spendAwayCents));
  ok('the best value is worked out, not claimed', p.bestValueId === 'coupon25', p.bestValueId);
  ok('the shop is sorted cheapest first',
    p.shop.every((r, i, a) => i === 0 || a[i - 1].cost <= r.cost));
  ok('and held boosts are counted', typeof p.boosts === 'number');

  const rich = await mkUser(`rich-${Date.now()}@example.test`);
  await grant(rich, 500);
  const q = await coinProgress(rich);
  ok('somebody who can afford everything has no next reward', q.next === null);
}

console.log('\n— The wiring both surfaces read —');
{
  const { readFileSync } = await import('node:fs');
  const acct = readFileSync(new URL('../src/routes/account.js', import.meta.url), 'utf8');
  const disc = readFileSync(new URL('../src/routes/discord.js', import.meta.url), 'utf8');
  ok('the account page reads coinProgress', /coinProgress\(/.test(acct));
  ok('…and so does the Discord balance', /coinProgress\(/.test(disc));
  /* The point of moving it: two surfaces cannot tell a member two different
     things about how far off their next reward is. */
  ok('the claim endpoint binds the giveaway into its signature',
    /boosts:\$\{b\.giveawayId/.test(disc), 'a captured request must not replay onto another draw');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} giveaway-boosts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
