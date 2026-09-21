/**
 * Daily login rewards, and the rules that keep them from costing the shop.
 *
 * ── THE DESIGN DECISION THIS FILE IS MOSTLY ABOUT ─────────────────────────
 * The obvious build pays the daily reward in the currency that already exists.
 * It would ruin the shop. A Forge Coin is earned at one per €10 of spend and
 * buys 33–38 cents of discount; 10 / 20 / 30 coins for three logins is about
 * €22 handed over for nothing — more than the margin on six orders — and a
 * fortnight of clicking a button would out-earn a real customer.
 *
 * So points are a SCORE, and the value lives in milestones the calendar bounds.
 * Several assertions below exist only to hold that line.
 *
 * ── AND THE ONE THAT IS ENFORCED BY THE DATABASE ──────────────────────────
 * "Once a day" is a unique index, not a check followed by an insert. Two tabs
 * racing produce one paid claim and one rejection; a check-then-write produces
 * two payments and a member who noticed.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { readFileSync } = await import('node:fs');
const { ensureReady } = await import('../src/app.js');
await ensureReady();
const svc = await import('../src/services/dailyRewardService.js');
const { openBoosts } = await import('../src/services/forgeCoinService.js');
const { run, get, all } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

let n = 0;
const mkUser = async ({ ageMinutes = 60 * 24 * 30 } = {}) => {
  n += 1;
  const id = newId('usr');
  const created = new Date(Date.now() - ageMinutes * 60_000).toISOString();
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id, @e, @at, @at)`,
    { id, e: `daily-${n}-${Date.now()}@example.test`, at: created });
  return id;
};
/** Claim as if it were a given day, so a streak can be built without waiting. */
const claimOn = (userId, iso, opts = {}) =>
  svc.claimDaily(userId, { now: new Date(iso), ...opts });

console.log('\n— The curve the brief asked for —');
{
  ok('day 1 pays 10 points', (await svc.rewardFor(1)).points === 10);
  ok('day 2 pays 20', (await svc.rewardFor(2)).points === 20);
  ok('day 3 pays 30', (await svc.rewardFor(3)).points === 30);
  const d7 = await svc.rewardFor(7);
  ok('day 7 carries a bonus reward', d7.kind === 'boost', JSON.stringify(d7));
  const d30 = await svc.rewardFor(30);
  ok('day 30 carries a premium reward', d30.kind === 'coupon' && d30.value === 500,
    JSON.stringify(d30));
  /* Uncapped, day 400 would pay four thousand points for the same click. */
  ok('the curve stops climbing', (await svc.rewardFor(400)).points === (await svc.rewardFor(10)).points);
  ok('…and never pays nothing', (await svc.rewardFor(1)).points > 0);
}

console.log('\n— Points are a score, not money —');
{
  /* The line this whole design exists to hold. If a day ever paid in the
     currency that buys discounts, three logins would be worth more than the
     margin on six orders. */
  const src = (await import('node:fs'))
    .readFileSync(new URL('../src/services/dailyRewardService.js', import.meta.url), 'utf8');
  ok('no daily reward touches the coin ledger',
    !/forge_coin_ledger/.test(src), 'a login must not mint Forge Coins');
  ok('…and nothing calls the coin award path',
    !/awardCoins|spendCoins|coinBalance/.test(src));
  /* The milestones are where the value is, and they are bounded by the
     calendar: day 30 comes round once every thirty days. */
  const table = await svc.rewardTable({ days: 30 });
  const withReward = table.filter((r) => r.kind);
  ok('only two days in a month are worth money', withReward.length === 2,
    JSON.stringify(withReward.map((r) => r.day)));
  const coupons = withReward.filter((r) => r.kind === 'coupon');
  ok('…and only one of those is a discount', coupons.length === 1);
  ok('…worth €5 for thirty days of turning up', coupons[0].value === 500);
}

console.log('\n— A streak, and what breaks it —');
{
  const u = await mkUser();
  const a = await claimOn(u, '2026-03-01T10:00:00Z');
  ok('the first claim is day 1', a.streakDay === 1 && a.points === 10);
  const b = await claimOn(u, '2026-03-02T09:00:00Z');
  ok('the next day continues it', b.streakDay === 2 && b.points === 20);
  ok('…even claimed an hour earlier than yesterday', b.currentStreak === 2);
  const c = await claimOn(u, '2026-03-03T12:00:00Z');
  ok('and again', c.streakDay === 3 && c.points === 30);
  ok('the total adds up', c.totalPoints === 60, String(c.totalPoints));

  /* A gap resets to day 1 — but the longest is kept, because it happened. */
  const d = await claimOn(u, '2026-03-06T10:00:00Z');
  ok('a missed day starts over at day 1', d.streakDay === 1 && d.points === 10);
  ok('…and the best run is remembered', d.longestStreak === 3, String(d.longestStreak));

  /* The trap this test walked into on its first run: 23:50 UTC is already
     tomorrow in Amsterdam, so a claim "late on Tuesday" lands on Wednesday and
     a claim on Thursday morning then looks like a missed day. The code was
     right and the fixture was wrong — which is the whole argument for the day
     boundary being the shop's and not UTC's. */
  const tzUser = await mkUser();
  await claimOn(tzUser, '2026-03-10T12:00:00Z');
  const nextEvening = await claimOn(tzUser, '2026-03-10T23:50:00Z');
  ok('a claim at 23:50 UTC counts as the NEXT local day',
    nextEvening.streakDay === 2, String(nextEvening.streakDay));
  ok('…which is why the boundary is the shop timezone, not UTC',
    svc.dayKey(new Date('2026-03-10T23:50:00Z')) === '2026-03-11');
}

console.log('\n— Once a day, enforced by the index —');
{
  const u = await mkUser();
  await claimOn(u, '2026-04-01T08:00:00Z');
  let refused = null;
  try { await claimOn(u, '2026-04-01T20:00:00Z'); } catch (e) { refused = e.message; }
  ok('a second claim the same day is refused', /already claimed today/i.test(refused || ''), refused);

  /* Two tabs. Without the unique index, both pass the "have you claimed?"
     check and both pay. */
  const u2 = await mkUser();
  const both = await Promise.allSettled([
    claimOn(u2, '2026-04-02T08:00:00Z'),
    claimOn(u2, '2026-04-02T08:00:00Z'),
  ]);
  const paid = both.filter((r) => r.status === 'fulfilled');
  ok('two simultaneous claims pay exactly once', paid.length === 1,
    JSON.stringify(both.map((r) => r.status)));
  const rows = await all(`SELECT id FROM daily_claims WHERE user_id=@u`, { u: u2 });
  ok('…and leave one row', rows.length === 1, String(rows.length));
  const streak = await svc.streakFor(u2);
  ok('…and one lot of points', Number(streak.total_points) === 10, String(streak.total_points));
}

console.log('\n— The milestones hand over the thing they promised —');
{
  const u = await mkUser();
  for (let d = 1; d <= 7; d++) {
    await claimOn(u, `2026-05-${String(d).padStart(2, '0')}T10:00:00Z`);
  }
  ok('day 7 was reached', (await svc.streakFor(u)).current_streak === 7);
  /* The promise on the card is an extra giveaway entry. A milestone that says
     so and hands over nothing is the mistake the Forge Shop's boost already
     made once. */
  ok('…and the giveaway boost actually exists', await openBoosts(u) === 1);

  const claim = await get(
    `SELECT milestone, reward_ref FROM daily_claims WHERE user_id=@u AND streak_day=7`, { u });
  ok('the claim row records which milestone', claim?.milestone === 'boost');
  ok('…and what was handed over', !!claim?.reward_ref);
}

console.log('\n— What the dashboard is told —');
{
  const u = await mkUser();
  const fresh = await svc.dailyStatus(u, { now: new Date('2026-06-01T10:00:00Z') });
  ok('a new member can claim', fresh.canClaim === true && fresh.currentStreak === 0);
  ok('…and is shown day 1 as next', fresh.nextClaimDay === 1 && fresh.nextReward.points === 10);
  ok('…with the next milestone named', fresh.nextMilestone?.day === 7,
    JSON.stringify(fresh.nextMilestone));

  await claimOn(u, '2026-06-01T10:00:00Z');
  const after = await svc.dailyStatus(u, { now: new Date('2026-06-01T18:00:00Z') });
  ok('after claiming, the button is off', after.canClaim === false && after.claimedToday === true);
  ok('…and the streak reads 1', after.currentStreak === 1);
  ok('…and the milestone is six days away', after.nextMilestone?.daysAway === 6,
    String(after.nextMilestone?.daysAway));

  /* The trap: after a lapse, "current streak + 1" is the wrong preview. It
     would show a day-9 reward and then pay day 1. */
  const u2 = await mkUser();
  for (let d = 1; d <= 8; d++) await claimOn(u2, `2026-07-0${d}T10:00:00Z`);
  const lapsed = await svc.dailyStatus(u2, { now: new Date('2026-07-20T10:00:00Z') });
  ok('a lapsed streak previews day 1, not day 9', lapsed.nextClaimDay === 1,
    String(lapsed.nextClaimDay));

  /* And once today is claimed, the dashboard's "tomorrow" has to be tomorrow.
     Showing the day just claimed tells somebody twelve days in that tomorrow is
     day 12 — which is the day they are looking at the receipt for. */
  const uTom = await mkUser();
  await claimOn(uTom, '2026-05-01T10:00:00Z');
  await claimOn(uTom, '2026-05-02T10:00:00Z');
  const done = await svc.dailyStatus(uTom, { now: new Date('2026-05-02T20:00:00Z') });
  ok('after claiming, today cannot be claimed again', done.claimedToday && !done.canClaim);
  ok('…and the next day previewed is tomorrow', done.nextClaimDay === 3,
    String(done.nextClaimDay));
  ok('…paying tomorrow\u2019s reward, not today\u2019s', done.nextReward.points === 30,
    String(done.nextReward.points));
  ok('…and says the streak lapsed', lapsed.streakLapsed === true);
  ok('…while still showing the best run', lapsed.longestStreak === 8);
}

console.log('\n— Fraud is flagged, and only one thing is blocked —');
{
  const ip = '198.51.100.77';
  const day = '2026-08-01T10:00:00Z';
  const users = [];
  for (let k = 0; k < 3; k++) {
    const u = await mkUser();
    users.push(u);
    await claimOn(u, day, { ip });
  }
  /* Three accounts on one connection is a household. A fourth is a farm — and
     unlike the other signals it is a pattern rather than a circumstance. */
  const fourth = await mkUser();
  let blocked = null;
  try { await claimOn(fourth, day, { ip }); } catch (e) { blocked = e.message; }
  ok('a fourth account on one connection is refused', !!blocked, blocked);
  ok('…without telling them which rule they hit',
    !/account|connection|ip/i.test(blocked || ''), blocked);
  const logged = await all(
    `SELECT action FROM audit_logs WHERE action='daily.claim_blocked' AND target_id=@u`,
    { u: fourth });
  ok('…and the refusal is audited', logged.length === 1);

  /* The softer signals are recorded, not enforced: a brand-new account and one
     that has never ordered are both normal for the people this feature exists
     to bring back. */
  const brandNew = await mkUser({ ageMinutes: 2 });
  const out = await claimOn(brandNew, '2026-08-02T10:00:00Z', { ip: '203.0.113.9' });
  ok('a minutes-old account still gets its reward', out.claimed === true);
  ok('…but is flagged as new', out.flags.includes('NEW_ACCOUNT'), JSON.stringify(out.flags));
  ok('…and as never having ordered', out.flags.includes('NO_ORDERS'));
  const stored = await get(`SELECT flags FROM daily_claims WHERE user_id=@u`, { u: brandNew });
  ok('the flags are stored with the claim, not only logged',
    /NEW_ACCOUNT/.test(stored?.flags || ''), stored?.flags);

  const shown = await svc.flaggedClaims({ limit: 50 });
  ok('and the admin can see them', shown.some((c) => c.flags.some((f) => f.code === 'NEW_ACCOUNT')));
}

console.log('\n— A reward the member can still find tomorrow —');
{
  /* The day-30 coupon was handed over in a toast and nowhere else. A dismissed
     toast is €5 gone and a support ticket, so the claim row's reference has to
     come back out of the API the dashboard reads. */
  const u = await mkUser();
  for (let d = 0; d < 30; d++) {
    await claimOn(u, new Date(Date.UTC(2026, 6, 1 + d, 10)).toISOString());
  }
  const st = await svc.dailyStatus(u, { now: new Date('2026-07-30T20:00:00Z') });
  ok('a member reaches day 30', st.currentStreak === 30, String(st.currentStreak));
  const earned = st.earned || [];
  ok('…and what they won is still on the dashboard', earned.length === 2,
    JSON.stringify(earned.map((e) => e.streakDay)));
  const coupon = earned.find((e) => e.kind === 'coupon');
  ok('…including the code itself', !!coupon?.code, JSON.stringify(coupon));
  /* And it is a real coupon, not a string that looks like one. */
  const real = await get(`SELECT value, kind FROM coupons WHERE code=@c`, { c: coupon?.code });
  ok('…which is a coupon that exists', Number(real?.value) === 500 && real?.kind === 'fixed',
    JSON.stringify(real));
  const boost = earned.find((e) => e.kind === 'boost');
  ok('…and the boost is named without leaking its id', !!boost && boost.code === null);
}

console.log('\n— Points buy giveaway entries, and nothing else —');
{
  const u = await mkUser();
  /* Ten days of turning up: 10+20+…+100 = 550 points. */
  for (let d = 0; d < 10; d++) {
    await claimOn(u, new Date(Date.UTC(2026, 2, 1 + d, 10)).toISOString());
  }
  const w0 = await svc.pointsWallet(u);
  ok('points have a balance, not just a total', w0.earned === 550 && w0.balance === 550,
    JSON.stringify(w0));
  ok('…and an exchange rate the member can see', w0.perBoost === 500 && w0.affordable === 1,
    JSON.stringify(w0));

  const before = await openBoosts(u);
  const out = await svc.redeemPointsForBoosts(u, 1);
  ok('a trade hands over a real entry', (await openBoosts(u)) === before + 1);
  ok('…and charges for exactly one', out.pointsSpent === 500);
  const w1 = await svc.pointsWallet(u);
  ok('…leaving the rest of the balance', w1.balance === 50, String(w1.balance));
  /* The lifetime total is what the streak is worth and what the leaderboard
     ranks on. Spending must not rewrite history. */
  ok('…without touching what was earned', w1.earned === 550, String(w1.earned));

  let poor = null;
  try { await svc.redeemPointsForBoosts(u, 1); } catch (e) { poor = e.message; }
  ok('a balance of 50 cannot buy a 500-point entry', /Not enough points/i.test(poor || ''), poor);
  ok('…and says what it costs and what they have', /500/.test(poor || '') && /50/.test(poor || ''));

  /* Two tabs on a balance of exactly one entry. A read-then-write would find
     "enough" twice and hand over two entries for one lot of points. */
  const racer = await mkUser();
  for (let d = 0; d < 10; d++) {
    await claimOn(racer, new Date(Date.UTC(2026, 3, 1 + d, 10)).toISOString());
  }
  const held = await openBoosts(racer);
  const both = await Promise.allSettled([
    svc.redeemPointsForBoosts(racer, 1),
    svc.redeemPointsForBoosts(racer, 1),
  ]);
  const won = both.filter((r) => r.status === 'fulfilled').length;
  ok('two tabs trading at once produce one entry', won === 1, JSON.stringify(both.map((r) => r.status)));
  ok('…and one entry was actually created', (await openBoosts(racer)) === held + 1);
  ok('…and only one lot of points left the balance',
    (await svc.pointsWallet(racer)).balance === 50,
    String((await svc.pointsWallet(racer)).balance));

  /* The daily status is what the card reads; the rate has to be in it or the
     button cannot say what it costs. */
  const st = await svc.dailyStatus(racer, { now: new Date('2026-04-10T20:00:00Z') });
  ok('the dashboard carries the wallet', st.wallet?.perBoost === 500 && st.wallet.balance === 50,
    JSON.stringify(st.wallet));
  ok('…and the entries already held', st.boosts >= 1, String(st.boosts));

  /* An entry bought with points is the same thing as one bought with coins —
     the draw cannot tell them apart, which is what makes it worth anything. */
  const src = await all(
    `SELECT source_ref FROM giveaway_boosts WHERE user_id=@u ORDER BY created_at DESC LIMIT 1`,
    { u: racer });
  ok('…and it is an ordinary boost the draw can claim', src[0]?.source_ref === 'points',
    JSON.stringify(src[0]));

  /* One boost per member per draw — which is what the card now says, and the
     reason it says it. Holding four is four boosted giveaways, not four
     tickets in one, and a strip promising otherwise would be the shop lying
     about a draw it runs itself. */
  const stacker = await mkUser();
  for (let d = 0; d < 20; d++) {
    await claimOn(stacker, new Date(Date.UTC(2026, 4, 1 + d, 10)).toISOString());
  }
  /* Twenty days includes day 7, so this member already holds the milestone
     boost before trading anything — measured as a delta rather than assumed. */
  const heldBefore = await openBoosts(stacker);
  await svc.redeemPointsForBoosts(stacker, 3);
  ok('three entries can be traded at once', (await openBoosts(stacker)) === heldBefore + 3,
    String(await openBoosts(stacker)));
  const { claimBoosts } = await import('../src/services/forgeCoinService.js');
  const used = await claimBoosts([stacker], 'gw_test_1');
  ok('…but one draw consumes exactly one', used[stacker] === 1, JSON.stringify(used));
  ok('…leaving the rest for later draws', (await openBoosts(stacker)) === heldBefore + 2,
    String(await openBoosts(stacker)));

  const hist = await svc.redemptionHistory(racer);
  ok('a trade is on the record', hist.length === 1 && hist[0].boosts === 1, JSON.stringify(hist));
  const aud = await all(
    `SELECT metadata FROM audit_logs WHERE action='daily.points_redeemed' AND target_id=@u`,
    { u: racer });
  ok('…and audited', aud.length === 1, String(aud.length));

  /* Points buy giveaway entries and nothing else: no path from this feature to
     the coin ledger, the wallet or a discount. */
  const src2 = readFileSync(new URL('../src/services/dailyRewardService.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('no route from points to money', !/awardCoins|spendCoins|forge_coin_ledger|creditWallet/.test(src2));
}

console.log('\n— Admin: the curve, a reset, and the numbers —');
{
  const custom = await svc.setRewardRule({ day: 2, points: 25, label: 'Tuesday bump',
    actor: { id: 'staff', email: 's@x.test' } });
  ok('a day can be re-priced', custom.points === 25 && custom.source === 'custom');
  ok('…and it is what a claim pays', (await svc.rewardFor(2)).points === 25);

  /* Changing the curve changes what the shop pays every day from then on. A
     month later, "who put day 2 up to 25?" has to have an answer, and the old
     value has to be in it — otherwise the log records that something changed
     and not what. */
  const setLog = await all(
    `SELECT metadata FROM audit_logs WHERE action='daily.rule_set' AND target_id='2'`);
  ok('…and re-pricing a day is audited', setLog.length === 1, String(setLog.length));
  ok('…with the value it had before', /"points":20/.test(setLog[0]?.metadata || ''),
    setLog[0]?.metadata);

  await svc.clearRewardRule(2, { actor: { id: 'staff', email: 's@x.test' } });
  ok('…and cleared back to the built-in curve', (await svc.rewardFor(2)).points === 20);
  const clearLog = await all(
    `SELECT metadata FROM audit_logs WHERE action='daily.rule_cleared' AND target_id='2'`);
  ok('…and clearing it is audited too', clearLog.length === 1, String(clearLog.length));

  let bad = null;
  try { await svc.setRewardRule({ day: 3, points: 10, kind: 'coupon' }); } catch (e) { bad = e.message; }
  ok('a coupon with no value is refused', /needs a value/i.test(bad || ''), bad);
  try { await svc.setRewardRule({ day: 0, points: 5 }); } catch (e) { bad = e.message; }
  ok('day zero is refused', /between 1 and/i.test(bad || ''));

  const u = await mkUser();
  await claimOn(u, '2026-09-01T10:00:00Z');
  await claimOn(u, '2026-09-02T10:00:00Z');
  const reset = await svc.resetStreak(u, { actor: { id: 'staff', email: 's@x.test' },
    reason: 'confirmed multi-accounting' });
  ok('a streak can be reset', Number(reset.current_streak) === 0);
  /* The claims are the record of what was paid, and usually the reason the
     reset is happening. Deleting them would erase the evidence. */
  const kept = await all(`SELECT id FROM daily_claims WHERE user_id=@u`, { u });
  ok('…without erasing what was already paid', kept.length === 2, String(kept.length));
  ok('…and the best run survives', Number(reset.longest_streak) === 2);
  const aud = await all(
    `SELECT metadata FROM audit_logs WHERE action='daily.streak_reset' AND target_id=@u`, { u });
  ok('…and it is audited with a reason', /multi-accounting/.test(aud[0]?.metadata || ''));

  const stats = await svc.dailyStats({ days: 3650, now: new Date('2026-10-01T00:00:00Z') });
  ok('the stats count claims', stats.claims > 0);
  ok('…and members', stats.members > 0);
  ok('…and points paid out', stats.pointsAwarded > 0);
  ok('…and milestones hit', stats.milestonesHit >= 1, String(stats.milestonesHit));
  ok('…and flagged claims', stats.flaggedClaims >= 1);
  ok('…and the longest streak anyone reached', stats.longestEver >= 8, String(stats.longestEver));
  ok('there is a leaderboard', Array.isArray(stats.top) && stats.top.length > 0);
}

console.log('\n— A day is a day in the shop timezone —');
{
  /* A dashboard that rolls over at 02:00 local time tells a member they already
     claimed when they have not — the same reason moneyService does this. */
  ok('midnight in Amsterdam is already tomorrow at 23:00 UTC',
    svc.dayKey(new Date('2026-03-01T23:00:00Z'), 'Europe/Amsterdam') === '2026-03-02');
  ok('…and the previous day steps back one', svc.previousDay('2026-03-01') === '2026-02-28');
  ok('…across a month end', svc.previousDay('2026-01-01') === '2025-12-31');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} daily-rewards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
