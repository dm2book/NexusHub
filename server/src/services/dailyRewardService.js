/**
 * Daily login rewards — a streak, a score, and two milestones that are worth
 * something.
 *
 * ── THE POINTS ARE NOT FORGE COINS, AND THAT IS THE WHOLE DESIGN ──────────
 * Paying the daily reward in the currency that already exists would ruin the
 * shop. A Forge Coin is earned at one per €10 of spend and buys 33–38 cents of
 * discount; forgeCoinService's own pricing note warns against loosening that.
 * Ten, twenty and thirty coins for three logins is about €22 of discount handed
 * over for nothing — more than the margin on six orders — and a fortnight of
 * clicking a button would out-earn a real customer.
 *
 * So points are a SCORE. The value lives in the milestones, and the milestones
 * are bounded by the calendar: day 30 comes round once every thirty days, and
 * only for somebody who actually turned up thirty times.
 *
 * ── ONE CLAIM PER DAY, NOT PER ROLLING 24 HOURS ───────────────────────────
 * A strict 24-hour window drifts later every day. Claim at 20:00 and you cannot
 * claim again until 20:00 tomorrow, so somebody who comes back at 19:00 loses
 * the day and the streak — it punishes exactly the habit this exists to build.
 * A calendar day in the shop's own timezone is the rule, and the unique index
 * on (user_id, day) is what enforces it. A check-then-insert can be raced by
 * two tabs and pay twice; an index cannot.
 *
 * ── FRAUD IS FLAGGED, NOT GUESSED AT ──────────────────────────────────────
 * Every signal here is something observed: how many different accounts claimed
 * from this address today, how old the account is, whether it has ever ordered.
 * A farm is loud on the first of those. None of them is proof on its own, so a
 * claim is recorded WITH its flags rather than silently refused — except the
 * one that is unambiguous, which is the same address running many accounts.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { config } from '../config/env.js';
import { badRequest } from '../utils/errors.js';
import { audit } from './auditService.js';
import { redeemBoostFor, openBoosts } from './forgeCoinService.js';

const TZ = () => config.timezone || 'Europe/Amsterdam';

/** A calendar day in the shop's timezone, as YYYY-MM-DD. */
export function dayKey(at = new Date(), tz = TZ()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at instanceof Date ? at : new Date(at));
}

/** The day before a key, without reintroducing a timezone. */
export function previousDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - 86_400_000;
  const p = new Date(t);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
}

/* The default curve: ten points a day, rising, and flat once it has done its
   job. The brief's 10 / 20 / 30 for days one to three is this formula, and the
   cap stops day 400 paying four thousand points for the same click. */
export const POINTS_CAP_DAY = 10;
export const defaultPoints = (day) => Math.max(1, Math.min(day, POINTS_CAP_DAY)) * 10;

/* Milestones, and why these two.
   Day 7 gives a giveaway boost: it costs the shop nothing real, and it is a
   thing the member can feel. Day 30 gives a €5 code — €5 of margin for thirty
   days of daily attention, which is a marketing number an owner can defend.
   Both are editable; these are only what the shop starts with. */
export const DEFAULT_RULES = [
  { day: 7, points: 70, reward_kind: 'boost', reward_value: 1, label: 'Giveaway boost' },
  { day: 30, points: 100, reward_kind: 'coupon', reward_value: 500, label: '€5 discount code' },
];

/** The reward for a given streak day: an owner's row if there is one, else the curve. */
export async function rewardFor(day) {
  const row = await get(`SELECT * FROM daily_reward_rules WHERE day=@d`, { d: day }).catch(() => null);
  if (row) {
    return {
      day, points: Number(row.points ?? 0),
      kind: row.reward_kind || null,
      value: row.reward_value == null ? null : Number(row.reward_value),
      label: row.label || null,
      source: 'custom',
    };
  }
  const preset = DEFAULT_RULES.find((r) => r.day === day);
  if (preset) {
    return { day, points: preset.points, kind: preset.reward_kind,
      value: preset.reward_value, label: preset.label, source: 'default' };
  }
  return { day, points: defaultPoints(day), kind: null, value: null, label: null, source: 'curve' };
}

/** Every day between now and the next one that carries more than points. */
export async function nextMilestone(fromDay) {
  const custom = await all(
    `SELECT day FROM daily_reward_rules WHERE reward_kind IS NOT NULL AND day > @d ORDER BY day ASC`,
    { d: fromDay }).catch(() => []);
  const days = [...new Set([
    ...custom.map((r) => Number(r.day)),
    ...DEFAULT_RULES.map((r) => r.day).filter((d) => d > fromDay),
  ])].sort((a, b) => a - b);
  if (!days.length) return null;
  const reward = await rewardFor(days[0]);
  return { ...reward, daysAway: days[0] - fromDay };
}

/** The member's row, created lazily so a first visit is not a write. */
export async function streakFor(userId) {
  const row = await get(`SELECT * FROM daily_streaks WHERE user_id=@u`, { u: userId });
  return row || {
    user_id: userId, current_streak: 0, longest_streak: 0,
    last_claim_day: null, last_claim_at: null, total_points: 0, total_claims: 0,
  };
}

/* ── Points buy giveaway entries, and nothing else ──────────────────────────
 *
 * The points were a score with no outlet: a member could look at 2,555 of them
 * and do nothing at all. A giveaway boost is the one reward this shop can hand
 * over without giving margin away — it is an extra entry in a draw that runs
 * anyway — so it is what points buy, and the only thing they buy.
 *
 * 500 a boost, against a curve that pays 2,555 for a perfect month: five
 * entries for thirty days of turning up. Cheap enough to be worth the click,
 * dear enough that the draw does not fill with one person's tickets.
 */
export const POINTS_PER_BOOST = 500;
export const MAX_BOOSTS_PER_REDEEM = 20;

/**
 * Earned, spent, and what is left.
 *
 * `total_points` stays the lifetime total — it is what the streak is worth and
 * what the leaderboard ranks on. The balance is a subtraction done here, in one
 * place, rather than a second column that can drift away from the claims that
 * produced it.
 */
export async function pointsWallet(userId) {
  const s = await streakFor(userId);
  const earned = Number(s.total_points || 0);
  const spent = Number(s.spent_points || 0);
  const balance = Math.max(0, earned - spent);
  return {
    earned, spent, balance,
    perBoost: POINTS_PER_BOOST,
    affordable: Math.floor(balance / POINTS_PER_BOOST),
    /* Stated so the card never has to do this sum itself and get it wrong. */
    toNextBoost: (POINTS_PER_BOOST - (balance % POINTS_PER_BOOST)) % POINTS_PER_BOOST,
  };
}

/**
 * Spend points on giveaway entries.
 *
 * The debit is a single conditional UPDATE, not a read followed by a write: two
 * tabs clicking together on a balance of 500 would both read "enough" and both
 * be granted, and the shop would have handed over two entries for one lot of
 * points. With the balance in the WHERE clause the loser updates no rows and is
 * told so.
 *
 * If a boost then fails to mint, the points for the ones that did not arrive go
 * back. A member who paid and received nothing must not also be out of pocket.
 */
export async function redeemPointsForBoosts(userId, count = 1, { actor = null, ip = null } = {}) {
  const n = Math.round(Number(count));
  if (!Number.isFinite(n) || n < 1) throw badRequest('Choose at least one entry.');
  if (n > MAX_BOOSTS_PER_REDEEM) {
    throw badRequest(`You can trade for at most ${MAX_BOOSTS_PER_REDEEM} entries at a time.`);
  }
  const cost = n * POINTS_PER_BOOST;

  const debit = await run(
    `UPDATE daily_streaks SET spent_points = spent_points + @c, updated_at = @at
      WHERE user_id = @u AND (total_points - spent_points) >= @c`,
    { u: userId, c: cost, at: nowIso() });
  if (!debit.changes) {
    const w = await pointsWallet(userId);
    throw badRequest(`Not enough points — that costs ${cost} and you have ${w.balance}.`);
  }

  const ids = [];
  let failed = 0;
  for (let k = 0; k < n; k++) {
    try {
      const out = await redeemBoostFor(userId, 'points');
      ids.push(out.boostId);
    } catch { failed += 1; }
  }

  if (failed) {
    const refund = failed * POINTS_PER_BOOST;
    await run(
      `UPDATE daily_streaks SET spent_points = GREATEST(0, spent_points - @r), updated_at = @at
        WHERE user_id = @u`, { u: userId, r: refund, at: nowIso() });
    await audit({ actor: actor || { id: userId }, action: 'daily.points_refunded',
      targetType: 'user', targetId: userId, metadata: { refund, failed } });
  }

  if (ids.length) {
    await run(
      `INSERT INTO point_redemptions (id, user_id, points, boosts, boost_ids, created_at)
       VALUES (@id, @u, @p, @b, @ids, @at)`,
      { id: newId('prd'), u: userId, p: ids.length * POINTS_PER_BOOST, b: ids.length,
        ids: JSON.stringify(ids), at: nowIso() });
  }

  await audit({ actor: actor || { id: userId }, action: 'daily.points_redeemed',
    targetType: 'user', targetId: userId, ip,
    metadata: { boosts: ids.length, points: ids.length * POINTS_PER_BOOST, failed } });

  if (!ids.length) throw badRequest('That could not be completed — your points are untouched.');
  return { boosts: ids.length, pointsSpent: ids.length * POINTS_PER_BOOST,
    wallet: await pointsWallet(userId) };
}

/** What a member has traded points for, most recent first. */
export async function redemptionHistory(userId, { limit = 10 } = {}) {
  const rows = await all(
    `SELECT points, boosts, created_at FROM point_redemptions
      WHERE user_id = @u ORDER BY created_at DESC LIMIT @l`, { u: userId, l: limit }).catch(() => []);
  return rows.map((r) => ({ points: Number(r.points), boosts: Number(r.boosts), at: r.created_at }));
}

/**
 * What this member has already won.
 *
 * A day-30 coupon was being handed over in a toast and nowhere else: dismiss it
 * and €5 is gone, with the code sitting in a column nothing read. The claim row
 * already stores the reference, so the dashboard can keep showing it.
 */
export async function earnedMilestones(userId, { limit = 8 } = {}) {
  const rows = await all(
    `SELECT day, streak_day, milestone, reward_ref, created_at FROM daily_claims
      WHERE user_id = @u AND milestone IS NOT NULL
      ORDER BY created_at DESC LIMIT @l`, { u: userId, l: limit }).catch(() => []);
  return rows.map((r) => ({
    day: r.day, streakDay: Number(r.streak_day), kind: r.milestone,
    /* A coupon's reference IS the code the member types; a boost's is an
       internal id, which is nothing to show anybody. */
    code: r.milestone === 'coupon' ? r.reward_ref || null : null,
    at: r.created_at,
  }));
}

/**
 * What the dashboard shows, and what the claim button is allowed to do.
 *
 * `streakDay` is the day the NEXT claim would be, in all three states:
 *   · already claimed today → tomorrow, which is this streak plus one;
 *   · claimed yesterday     → today, also this streak plus one;
 *   · lapsed or new         → day 1, NOT the streak plus one.
 * The third case is why this is not one expression: a preview of day 9 followed
 * by a payment of day 1 is a member writing in. The first case is the one the
 * dashboard shows under "Tomorrow", and returning the day just claimed there
 * told somebody on a twelve-day streak that tomorrow is day 12.
 */
export async function dailyStatus(userId, { now = new Date() } = {}) {
  const s = await streakFor(userId);
  const today = dayKey(now);
  const claimedToday = s.last_claim_day === today;
  const continues = s.last_claim_day === previousDay(today);
  const streakDay = (claimedToday || continues) ? Number(s.current_streak || 0) + 1 : 1;

  const [reward, upcoming, earned, wallet, boosts] = await Promise.all([
    rewardFor(streakDay),
    nextMilestone(claimedToday ? Number(s.current_streak || 0) : streakDay - 1),
    earnedMilestones(userId),
    pointsWallet(userId),
    openBoosts(userId),
  ]);

  return {
    currentStreak: Number(s.current_streak || 0),
    longestStreak: Number(s.longest_streak || 0),
    totalPoints: Number(s.total_points || 0),
    totalClaims: Number(s.total_claims || 0),
    lastClaimAt: s.last_claim_at || null,
    lastClaimDay: s.last_claim_day || null,
    today,
    canClaim: !claimedToday,
    claimedToday,
    /* A lapsed streak is stated rather than left for the member to work out
       from two dates. */
    streakLapsed: !claimedToday && !continues && !!s.last_claim_day,
    nextClaimDay: streakDay,
    nextReward: reward,
    nextMilestone: upcoming,
    earned,
    /* What the points are actually worth, alongside the points themselves —
       a balance shown without its exchange rate is a number nobody can act on. */
    wallet,
    /* Entries already held, from any source: bought with coins, won at day 7,
       or traded for here. The card counts them in one place. */
    boosts,
  };
}

/**
 * Signals worth acting on, each of them measured.
 *
 * Returned rather than thrown, so a claim is RECORDED with what was noticed.
 * A refusal that leaves no trace teaches nobody anything, and most of these are
 * suspicion rather than proof.
 */
export async function fraudSignals(userId, { ip = null, now = new Date(),
  maxAccountsPerIp = 3, newAccountMinutes = 10 } = {}) {
  const flags = [];
  let block = null;

  if (ip) {
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const rows = await all(
      `SELECT DISTINCT user_id FROM daily_claims
        WHERE ip = @ip AND created_at >= @since AND user_id <> @u`,
      { ip, since, u: userId }).catch(() => []);
    if (rows.length + 1 > maxAccountsPerIp) {
      /* The one unambiguous signal. Several accounts claiming from one address
         in a day is a farm, not a household — and unlike the others it is a
         pattern rather than a circumstance. */
      block = `${rows.length + 1} accounts have claimed from this connection today`;
      flags.push({ code: 'MULTI_ACCOUNT_IP', detail: block, accounts: rows.length + 1 });
    } else if (rows.length) {
      flags.push({ code: 'SHARED_IP', detail: `${rows.length} other account(s) on this connection today` });
    }
  }

  const user = await get(
    `SELECT created_at, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders
       FROM users u WHERE u.id = @u`, { u: userId }).catch(() => null);
  if (user) {
    const ageMin = (now.getTime() - Date.parse(user.created_at)) / 60_000;
    if (Number.isFinite(ageMin) && ageMin < newAccountMinutes) {
      flags.push({ code: 'NEW_ACCOUNT', detail: `account is ${Math.round(ageMin)} minute(s) old` });
    }
    /* Not abuse on its own — the feature exists to bring people back before
       they buy. Recorded so a pattern across many accounts is visible. */
    if (Number(user.orders || 0) === 0) flags.push({ code: 'NO_ORDERS', detail: 'has never ordered' });
  }
  return { flags, block };
}

/**
 * Claim today.
 *
 * The insert is the lock: UNIQUE (user_id, day) means two tabs racing produce
 * one paid claim and one rejection, with no check-then-write window in between.
 */
export async function claimDaily(userId, { ip = null, now = new Date(), actor = null } = {}) {
  const today = dayKey(now);
  const s = await streakFor(userId);
  if (s.last_claim_day === today) throw badRequest('You have already claimed today.');

  const { flags, block } = await fraudSignals(userId, { ip, now });
  if (block) {
    await audit({ actor: actor || { id: userId }, action: 'daily.claim_blocked',
      targetType: 'user', targetId: userId, ip, metadata: { reason: block, flags } });
    throw badRequest('This claim could not be completed. If that seems wrong, contact support.');
  }

  const continues = s.last_claim_day === previousDay(today);
  const streakDay = continues ? Number(s.current_streak || 0) + 1 : 1;
  const reward = await rewardFor(streakDay);

  const id = newId('dcl');
  const at = nowIso();
  try {
    await run(
      `INSERT INTO daily_claims (id, user_id, day, streak_day, points, milestone, ip, flags, created_at)
       VALUES (@id, @u, @day, @sd, @pts, @ms, @ip, @flags, @at)`,
      { id, u: userId, day: today, sd: streakDay, pts: reward.points,
        ms: reward.kind || null, ip, flags: JSON.stringify(flags), at });
  } catch {
    /* Lost the race with another tab. The other one paid; this one says so
       rather than paying twice. */
    throw badRequest('You have already claimed today.');
  }

  const longest = Math.max(Number(s.longest_streak || 0), streakDay);
  await run(
    `INSERT INTO daily_streaks (user_id, current_streak, longest_streak, last_claim_day,
                                last_claim_at, total_points, total_claims, created_at, updated_at)
     VALUES (@u, @cur, @long, @day, @at, @pts, 1, @at, @at)
     ON CONFLICT (user_id) DO UPDATE SET
       current_streak = @cur, longest_streak = @long, last_claim_day = @day,
       last_claim_at = @at, total_points = daily_streaks.total_points + @pts,
       total_claims = daily_streaks.total_claims + 1, updated_at = @at`,
    { u: userId, cur: streakDay, long: longest, day: today, at, pts: reward.points });

  /* A milestone that promises a thing has to hand the thing over. Best-effort
     and audited: a member who reached day 30 and whose coupon failed to mint
     must not also lose the streak, and somebody has to be able to see it. */
  let granted = null;
  if (reward.kind) {
    try {
      granted = await grantMilestone(userId, reward);
      if (granted?.ref) {
        await run(`UPDATE daily_claims SET reward_ref=@r WHERE id=@id`, { r: granted.ref, id });
      }
    } catch (e) {
      await audit({ actor: { id: userId }, action: 'daily.milestone_failed',
        targetType: 'user', targetId: userId, metadata: { day: streakDay, error: e.message } });
    }
  }

  await audit({ actor: actor || { id: userId }, action: 'daily.claimed',
    targetType: 'user', targetId: userId, ip,
    metadata: { day: today, streakDay, points: reward.points, milestone: reward.kind || null,
      flags: flags.map((f) => f.code) } });

  return {
    claimed: true, day: today, streakDay, points: reward.points,
    reward: reward.kind ? { ...reward, granted } : null,
    currentStreak: streakDay, longestStreak: longest,
    totalPoints: Number(s.total_points || 0) + reward.points,
    flags: flags.map((f) => f.code),
  };
}

/** Hand over what a milestone promised. */
async function grantMilestone(userId, reward) {
  if (reward.kind === 'boost') {
    const out = await redeemBoostFor(userId, `daily:${reward.day}`);
    return { kind: 'boost', ref: out.boostId };
  }
  if (reward.kind === 'coupon' && reward.value > 0) {
    const { createCoupon } = await import('./couponService.js');
    const code = `DAY${reward.day}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await createCoupon({ code, kind: 'fixed', value: reward.value, perUserLimit: 1,
      maxRedemptions: 1, active: true, announce: false }, userId);
    return { kind: 'coupon', ref: code, code };
  }
  return null;
}

/* ── Admin ──────────────────────────────────────────────────────────────── */

/** The curve as the owner sees it: the first N days, with which rows are theirs. */
export async function rewardTable({ days = 30 } = {}) {
  const out = [];
  for (let d = 1; d <= days; d++) out.push(await rewardFor(d));
  return out;
}

export async function setRewardRule({ day, points, kind = null, value = null, label = null,
  actor = null }) {
  const d = Math.round(Number(day));
  if (!Number.isFinite(d) || d < 1 || d > 3650) throw badRequest('Day must be between 1 and 3650.');
  const p = Math.round(Number(points));
  if (!Number.isFinite(p) || p < 0) throw badRequest('Points must be zero or more.');
  if (kind && !['boost', 'coupon'].includes(kind)) throw badRequest('Unknown reward kind.');
  if (kind === 'coupon' && !(Number(value) > 0)) throw badRequest('A coupon needs a value in cents.');
  const before = await rewardFor(d);
  await run(
    `INSERT INTO daily_reward_rules (day, points, reward_kind, reward_value, label, updated_at)
     VALUES (@d, @p, @k, @v, @l, @at)
     ON CONFLICT (day) DO UPDATE SET points=@p, reward_kind=@k, reward_value=@v,
       label=@l, updated_at=@at`,
    { d, p, k: kind, v: kind ? Number(value) : null, l: label, at: nowIso() });
  /* Audited with what it was as well as what it became: "day 7 now pays a €20
     code" is only alarming next to the boost it replaced. */
  const after = await rewardFor(d);
  await audit({ actor, action: 'daily.rule_set', targetType: 'daily_rule', targetId: String(d),
    metadata: { before, after } });
  return after;
}

export async function clearRewardRule(day, { actor = null } = {}) {
  const d = Math.round(Number(day));
  const before = await rewardFor(d);
  await run(`DELETE FROM daily_reward_rules WHERE day=@d`, { d });
  const after = await rewardFor(d);
  await audit({ actor, action: 'daily.rule_cleared', targetType: 'daily_rule', targetId: String(d),
    metadata: { before, after } });
  return after;
}

/**
 * Reset somebody's streak.
 *
 * The claim history is NOT deleted. It is the audit trail of what was paid, and
 * a reset is a decision about the future — erasing the past would also erase
 * the evidence of whatever prompted the reset.
 */
export async function resetStreak(userId, { actor, reason = '' } = {}) {
  const before = await streakFor(userId);
  await run(
    `UPDATE daily_streaks SET current_streak = 0, last_claim_day = NULL, updated_at = @at
      WHERE user_id = @u`, { u: userId, at: nowIso() });
  await audit({ actor, action: 'daily.streak_reset', targetType: 'user', targetId: userId,
    metadata: { reason, was: Number(before.current_streak || 0) } });
  return streakFor(userId);
}

/** What the feature is actually doing, from the claims themselves. */
export async function dailyStats({ days = 30, now = new Date() } = {}) {
  const since = dayKey(new Date(now.getTime() - days * 86_400_000));
  const totals = await get(
    `SELECT COUNT(*) AS claims, COUNT(DISTINCT user_id) AS members,
            COALESCE(SUM(points), 0) AS points,
            COUNT(*) FILTER (WHERE milestone IS NOT NULL) AS milestones,
            COUNT(*) FILTER (WHERE flags <> '[]') AS flagged
       FROM daily_claims WHERE day >= @since`, { since }).catch(() => null);
  const byDay = await all(
    `SELECT day, COUNT(*) AS claims FROM daily_claims
      WHERE day >= @since GROUP BY day ORDER BY day ASC`, { since }).catch(() => []);
  const streaks = await get(
    `SELECT COUNT(*) FILTER (WHERE current_streak > 0) AS active,
            COALESCE(MAX(longest_streak), 0) AS longest,
            COALESCE(AVG(NULLIF(current_streak, 0)), 0) AS avg_active
       FROM daily_streaks`).catch(() => null);
  const top = await all(
    `SELECT s.user_id, u.email, s.current_streak, s.longest_streak, s.total_points,
            s.spent_points
       FROM daily_streaks s JOIN users u ON u.id = s.user_id
      ORDER BY s.current_streak DESC, s.longest_streak DESC LIMIT 10`).catch(() => []);

  /* What the points actually cost the shop, which is nothing in euros and some
     dilution of the draw. Shown because "points are free" is only true while
     somebody is watching how many entries they turn into. */
  const traded = await get(
    `SELECT COALESCE(SUM(boosts), 0) AS boosts, COALESCE(SUM(points), 0) AS points,
            COUNT(DISTINCT user_id) AS members
       FROM point_redemptions WHERE created_at >= @since`, { since }).catch(() => null);

  return {
    days,
    claims: Number(totals?.claims || 0),
    members: Number(totals?.members || 0),
    pointsAwarded: Number(totals?.points || 0),
    milestonesHit: Number(totals?.milestones || 0),
    flaggedClaims: Number(totals?.flagged || 0),
    activeStreaks: Number(streaks?.active || 0),
    longestEver: Number(streaks?.longest || 0),
    averageActiveStreak: Math.round(Number(streaks?.avg_active || 0) * 10) / 10,
    pointsTraded: Number(traded?.points || 0),
    entriesTraded: Number(traded?.boosts || 0),
    tradingMembers: Number(traded?.members || 0),
    pointsPerBoost: POINTS_PER_BOOST,
    byDay: byDay.map((r) => ({ day: r.day, claims: Number(r.claims) })),
    top: top.map((r) => ({
      userId: r.user_id, email: r.email,
      currentStreak: Number(r.current_streak), longestStreak: Number(r.longest_streak),
      totalPoints: Number(r.total_points),
      pointsLeft: Math.max(0, Number(r.total_points || 0) - Number(r.spent_points || 0)),
    })),
  };
}

/** Claims that noticed something, for the admin to look at. */
export async function flaggedClaims({ limit = 50 } = {}) {
  const rows = await all(
    `SELECT c.*, u.email FROM daily_claims c JOIN users u ON u.id = c.user_id
      WHERE c.flags <> '[]' ORDER BY c.created_at DESC LIMIT @l`, { l: limit }).catch(() => []);
  return rows.map((r) => {
    let flags = [];
    try { flags = JSON.parse(r.flags || '[]'); } catch { flags = []; }
    return { id: r.id, userId: r.user_id, email: r.email, day: r.day,
      streakDay: Number(r.streak_day), points: Number(r.points), ip: r.ip,
      flags, createdAt: r.created_at };
  });
}
