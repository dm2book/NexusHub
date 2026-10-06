/**
 * The community layer: XP, levels, badges, achievements, referral levels,
 * streaks and community milestones.
 *
 * ── NOTHING HERE IS STORED, SO NOTHING CAN DRIFT OR BE INVENTED ───────────
 * Every number is recomputed from the tables that record what actually
 * happened: completed, paid orders (never a test payment, never a refund),
 * verified reviews tied to a delivered order, referrals whose friend really
 * completed an order, and daily claims. There is no XP column to edit, no
 * seeded ranking and no "members online" figure — a level is what a person
 * did, and a milestone is what the shop really reached.
 *
 * There is also no public leaderboard. Ranking customers against each other
 * would publish who buys how much; the owner sees distributions, never names
 * next to spend, and a customer sees only their own progress.
 */
import { all, get } from '../db/index.js';
import { config } from '../config/env.js';

/* ── What earns XP — the whole rulebook, shown to customers as-is ───────── */
export const XP_RULES = [
  { id: 'euro', label: 'per hele euro besteed', xp: 1 },
  { id: 'order', label: 'per afgeronde bestelling', xp: 20 },
  { id: 'review', label: 'per geverifieerde review', xp: 30 },
  { id: 'referral', label: 'per vriend die echt bestelde', xp: 100 },
  { id: 'claim', label: 'per dagelijkse check-in', xp: 2 },
  { id: 'discord', label: 'eenmalig: Discord gekoppeld', xp: 25 },
];
const XP = Object.fromEntries(XP_RULES.map((r) => [r.id, r.xp]));

export const LEVELS = [
  { level: 1, name: 'Nieuwkomer', min: 0 },
  { level: 2, name: 'Speler', min: 50 },
  { level: 3, name: 'Vaste klant', min: 150 },
  { level: 4, name: 'Grinder', min: 300 },
  { level: 5, name: 'Veteraan', min: 500 },
  { level: 6, name: 'Elite', min: 800 },
  { level: 7, name: 'Kampioen', min: 1200 },
  { level: 8, name: 'Meester', min: 1700 },
  { level: 9, name: 'Grootmeester', min: 2400 },
  { level: 10, name: 'Legende', min: 3300 },
];

export const REFERRAL_LEVELS = [
  { id: 'none', name: 'Nog geen', min: 0 },
  { id: 'scout', name: 'Scout', min: 1 },
  { id: 'recruiter', name: 'Recruiter', min: 3 },
  { id: 'ambassador', name: 'Ambassadeur', min: 10 },
  { id: 'legend', name: 'Legende', min: 25 },
];

/* Milestone targets the shop as a whole moves through. */
export const MILESTONE_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function levelFor(xp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.min) cur = l;
  const next = LEVELS.find((l) => l.min > xp) || null;
  const progress = next ? Math.round(((xp - cur.min) / (next.min - cur.min)) * 100) : 100;
  return { ...cur, xp, next: next ? { level: next.level, name: next.name, min: next.min, remaining: next.min - xp } : null, progress };
}
export function referralLevelFor(n) {
  let cur = REFERRAL_LEVELS[0];
  for (const l of REFERRAL_LEVELS) if (n >= l.min) cur = l;
  const next = REFERRAL_LEVELS.find((l) => l.min > n) || null;
  return { ...cur, count: n, next: next ? { id: next.id, name: next.name, min: next.min, remaining: next.min - n } : null };
}

/* ── The raw facts, for one user or for everyone, in a handful of queries ─ */
const REAL_ORDERS = `
  SELECT o.id, o.user_id, o.total, o.created_at,
         COALESCE((o.billing::jsonb ->> 'creditApplied')::numeric, 0) AS credit
    FROM orders o
    LEFT JOIN social_events s ON s.order_id = o.id
   WHERE o.status = 'completed' AND COALESCE(s.test, 0) = 0
     AND (o.total > 0 OR COALESCE((o.billing::jsonb ->> 'creditApplied')::numeric, 0) > 0)`;

const byUser = (rows, key = 'user_id') => {
  const m = new Map();
  for (const r of rows) { const k = r[key]; if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};

/** Every fact the layer is built on, grouped per user. `userId` narrows it. */
export async function loadFacts({ userId = null } = {}) {
  const w = userId ? 'AND o.user_id = @u' : 'AND o.user_id IS NOT NULL';
  const p = userId ? { u: userId } : {};
  const orders = await all(`SELECT DISTINCT ON (x.id) x.* FROM (${REAL_ORDERS} ${w}) x ORDER BY x.id`, p).catch(() => []);
  const cats = await all(`SELECT o.user_id, p.category, MIN(o.created_at) AS first_at
      FROM (${REAL_ORDERS} ${w}) o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
     GROUP BY o.user_id, p.category`, p).catch(() => []);
  const reviews = await all(`SELECT user_id, created_at FROM reviews
     WHERE verified = 1 AND status = 'visible' AND user_id IS NOT NULL ${userId ? 'AND user_id = @u' : ''}`, p).catch(() => []);
  const referrals = await all(`SELECT re.referrer_id AS user_id, re.referred_id, MIN(o.created_at) AS at
      FROM referral_events re JOIN orders o ON o.id = re.order_id
     WHERE re.kind = 'order' AND re.status NOT IN ('void', 'reversed') AND o.status = 'completed'
       AND re.referrer_id IS NOT NULL ${userId ? 'AND re.referrer_id = @u' : ''}
     GROUP BY re.referrer_id, re.referred_id`, p).catch(() => []);
  const streaks = await all(`SELECT user_id, current_streak, longest_streak, last_claim_day, total_claims
      FROM daily_streaks ${userId ? 'WHERE user_id = @u' : ''}`, p).catch(() => []);
  const discord = await all(`SELECT user_id, MIN(created_at) AS at FROM oauth_accounts
     WHERE provider = 'discord' ${userId ? 'AND user_id = @u' : ''} GROUP BY user_id`, p).catch(() => []);
  const members = await all(`SELECT id AS user_id, membership_until FROM users
     WHERE membership_until IS NOT NULL ${userId ? 'AND id = @u' : ''}`, p).catch(() => []);
  return {
    orders: byUser(orders.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))),
    cats: byUser(cats), reviews: byUser(reviews.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))),
    referrals: byUser(referrals.sort((a, b) => String(a.at).localeCompare(String(b.at)))),
    streaks: new Map(streaks.map((s) => [s.user_id, s])), discord: new Map(discord.map((d) => [d.user_id, d])),
    members: new Map(members.map((m) => [m.user_id, m])),
  };
}

/* ── Derived stats for one user ────────────────────────────────────────── */
const monthKey = (iso) => String(iso).slice(0, 7);
const prevMonth = (key) => { const [y, m] = key.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const amsterdamHour = (iso) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).format(new Date(iso)));

/** Consecutive calendar months with a completed order, ending this month or last. */
export function monthStreak(orderDates, now = new Date()) {
  const months = new Set(orderDates.map(monthKey));
  let key = monthKey(now.toISOString());
  if (!months.has(key)) key = prevMonth(key);
  let n = 0;
  while (months.has(key)) { n += 1; key = prevMonth(key); }
  return n;
}
function longestMonthRun(orderDates) {
  const keys = [...new Set(orderDates.map(monthKey))].sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) { run = prev && prevMonth(k) === prev ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  return best;
}

export function statsFor(userId, F, { now = new Date() } = {}) {
  const orders = F.orders.get(userId) || [];
  const reviews = F.reviews.get(userId) || [];
  const referrals = F.referrals.get(userId) || [];
  const cats = F.cats.get(userId) || [];
  const streak = F.streaks.get(userId) || null;
  const discord = F.discord.get(userId) || null;
  const member = F.members.get(userId) || null;
  let running = 0;
  /* Money paid plus store credit spent (both cents): credit is real money
     the customer earned or topped up earlier. */
  const spendAt = orders.map((o) => { running += Number(o.total || 0) + Number(o.credit || 0); return { at: o.created_at, cents: running }; });
  const spent = running;
  return {
    orders: orders.length, orderDates: orders.map((o) => o.created_at), spentCents: spent, spendAt,
    categories: cats.length, categoryDates: cats.map((c) => c.first_at).sort(),
    reviews: reviews.length, reviewDates: reviews.map((r) => r.created_at),
    referrals: referrals.length, referralDates: referrals.map((r) => r.at),
    dailyCurrent: Number(streak?.current_streak || 0), dailyLongest: Number(streak?.longest_streak || 0),
    claims: Number(streak?.total_claims || 0),
    monthStreak: monthStreak(orders.map((o) => o.created_at), now), monthLongest: longestMonthRun(orders.map((o) => o.created_at)),
    discordAt: discord?.at || null,
    memberUntil: member?.membership_until || null,
    nightOrderAt: orders.find((o) => amsterdamHour(o.created_at) < 5)?.created_at || null,
  };
}

export function xpFor(s) {
  const parts = [
    { id: 'euro', count: Math.floor(s.spentCents / 100) },
    { id: 'order', count: s.orders },
    { id: 'review', count: s.reviews },
    { id: 'referral', count: s.referrals },
    { id: 'claim', count: s.claims },
    { id: 'discord', count: s.discordAt ? 1 : 0 },
  ].map((p) => ({ ...p, label: XP_RULES.find((r) => r.id === p.id).label, xp: p.count * XP[p.id] }));
  return { total: parts.reduce((a, p) => a + p.xp, 0), parts };
}

/* ── Badges and achievements: each a test on real stats, dated when it can be ─ */
const nth = (dates, n) => (dates.length >= n ? dates[n - 1] : null);
const spendDate = (s, cents) => s.spendAt.find((x) => x.cents >= cents)?.at || null;
const launchAt = () => (config.launch?.date ? new Date(config.launch.date) : null);

export const ACHIEVEMENTS = [
  // orders
  { id: 'first-order', kind: 'achievement', group: 'Bestellingen', icon: '🛒', name: 'Eerste bestelling', desc: 'Je eerste afgeronde bestelling.', target: 1, value: (s) => s.orders, at: (s) => nth(s.orderDates, 1) },
  { id: 'regular', kind: 'achievement', group: 'Bestellingen', icon: '🔁', name: 'Vaste klant', desc: '5 afgeronde bestellingen.', target: 5, value: (s) => s.orders, at: (s) => nth(s.orderDates, 5) },
  { id: 'loyal', kind: 'achievement', group: 'Bestellingen', icon: '💎', name: 'Trouw', desc: '10 afgeronde bestellingen.', target: 10, value: (s) => s.orders, at: (s) => nth(s.orderDates, 10) },
  { id: 'collector', kind: 'achievement', group: 'Bestellingen', icon: '🏆', name: 'Verzamelaar', desc: '25 afgeronde bestellingen.', target: 25, value: (s) => s.orders, at: (s) => nth(s.orderDates, 25) },
  { id: 'explorer', kind: 'achievement', group: 'Bestellingen', icon: '🧭', name: 'Ontdekker', desc: 'Iets gekocht in 3 verschillende categorieën.', target: 3, value: (s) => s.categories, at: (s) => nth(s.categoryDates, 3) },
  { id: 'spend-100', kind: 'achievement', group: 'Bestellingen', icon: '💶', name: '€100 club', desc: 'In totaal €100 besteed.', target: 10000, value: (s) => s.spentCents, at: (s) => spendDate(s, 10000), money: true },
  { id: 'spend-500', kind: 'achievement', group: 'Bestellingen', icon: '💰', name: '€500 club', desc: 'In totaal €500 besteed.', target: 50000, value: (s) => s.spentCents, at: (s) => spendDate(s, 50000), money: true },
  // community
  { id: 'first-review', kind: 'achievement', group: 'Community', icon: '✍️', name: 'Eerste review', desc: 'Een geverifieerde review geschreven.', target: 1, value: (s) => s.reviews, at: (s) => nth(s.reviewDates, 1) },
  { id: 'critic', kind: 'achievement', group: 'Community', icon: '📝', name: 'Recensent', desc: '5 geverifieerde reviews.', target: 5, value: (s) => s.reviews, at: (s) => nth(s.reviewDates, 5) },
  { id: 'first-referral', kind: 'achievement', group: 'Community', icon: '🤝', name: 'Eerste vriend', desc: 'Een vriend die via jouw link echt bestelde.', target: 1, value: (s) => s.referrals, at: (s) => nth(s.referralDates, 1) },
  { id: 'recruiter', kind: 'achievement', group: 'Community', icon: '📣', name: 'Recruiter', desc: '3 vrienden die echt bestelden.', target: 3, value: (s) => s.referrals, at: (s) => nth(s.referralDates, 3) },
  { id: 'ambassador', kind: 'achievement', group: 'Community', icon: '🎖️', name: 'Ambassadeur', desc: '10 vrienden die echt bestelden.', target: 10, value: (s) => s.referrals, at: (s) => nth(s.referralDates, 10) },
  // streaks
  { id: 'streak-7', kind: 'achievement', group: 'Streaks', icon: '🔥', name: 'Week vol', desc: '7 dagen op rij ingecheckt.', target: 7, value: (s) => s.dailyLongest, at: () => null },
  { id: 'streak-30', kind: 'achievement', group: 'Streaks', icon: '☄️', name: 'Maand vol', desc: '30 dagen op rij ingecheckt.', target: 30, value: (s) => s.dailyLongest, at: () => null },
  { id: 'months-3', kind: 'achievement', group: 'Streaks', icon: '📅', name: 'Drie maanden', desc: '3 maanden op rij iets besteld.', target: 3, value: (s) => s.monthLongest, at: () => null },
  // badges — who you are here, not how much you did
  { id: 'discord', kind: 'badge', group: 'Badges', icon: '💬', name: 'Discord', desc: 'Discord gekoppeld aan je account.', target: 1, value: (s) => (s.discordAt ? 1 : 0), at: (s) => s.discordAt },
  { id: 'forge-plus', kind: 'badge', group: 'Badges', icon: '⚡', name: 'Forge+', desc: 'Forge+ lid (geweest).', target: 1, value: (s) => (s.memberUntil ? 1 : 0), at: () => null },
  { id: 'early', kind: 'badge', group: 'Badges', icon: '🌱', name: 'Early supporter', desc: 'Besteld in de eerste 30 dagen na de opening.', target: 1,
    value: (s) => { const l = launchAt(); const first = s.orderDates[0]; return l && first && new Date(first) - l <= 30 * 86_400_000 ? 1 : 0; },
    at: (s) => s.orderDates[0] || null },
  { id: 'night-owl', kind: 'badge', group: 'Badges', icon: '🦉', name: 'Nachtuil', desc: 'Besteld tussen middernacht en 05:00.', target: 1, value: (s) => (s.nightOrderAt ? 1 : 0), at: (s) => s.nightOrderAt },
];

export function awardsFor(s) {
  return ACHIEVEMENTS.map((a) => {
    const value = Number(a.value(s)) || 0;
    const earned = value >= a.target;
    return { id: a.id, kind: a.kind, group: a.group, icon: a.icon, name: a.name, desc: a.desc,
      earned, earnedAt: earned ? a.at(s) : null, progress: { value: Math.min(value, a.target), target: a.target, money: !!a.money } };
  });
}

/** One customer's own community profile. */
export async function communityProfile(userId, { now = new Date() } = {}) {
  const F = await loadFacts({ userId });
  const s = statsFor(userId, F, { now });
  const xp = xpFor(s);
  const awards = awardsFor(s);
  return {
    level: levelFor(xp.total), xp, levels: LEVELS, xpRules: XP_RULES,
    referral: referralLevelFor(s.referrals), referralLevels: REFERRAL_LEVELS,
    streaks: { daily: { current: s.dailyCurrent, longest: s.dailyLongest }, months: { current: s.monthStreak, longest: s.monthLongest } },
    achievements: awards.filter((a) => a.kind === 'achievement'),
    badges: awards.filter((a) => a.kind === 'badge'),
    counts: { orders: s.orders, reviews: s.reviews, referrals: s.referrals, categories: s.categories },
  };
}

/* ── Community milestones: what the shop as a whole really reached ─────── */
export async function milestoneCounts() {
  const one = async (sql) => Number((await get(sql).catch(() => null))?.n || 0);
  return {
    orders: await one(`SELECT COUNT(DISTINCT x.id) AS n FROM (${REAL_ORDERS}) x`),
    buyers: await one(`SELECT COUNT(DISTINCT LOWER(o.email)) AS n FROM orders o WHERE o.id IN (SELECT x.id FROM (${REAL_ORDERS}) x)`),
    items: await one(`SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi WHERE oi.order_id IN (SELECT x.id FROM (${REAL_ORDERS}) x)`),
    reviews: await one(`SELECT COUNT(*) AS n FROM reviews WHERE verified = 1 AND status = 'visible'`),
    referrals: await one(`SELECT COUNT(DISTINCT re.referred_id) AS n FROM referral_events re JOIN orders o ON o.id = re.order_id
       WHERE re.kind = 'order' AND re.status NOT IN ('void', 'reversed') AND o.status = 'completed'`),
    checkins: await one(`SELECT COUNT(*) AS n FROM daily_claims`),
  };
}
export const MILESTONE_LABEL = {
  orders: 'afgeronde bestellingen', buyers: 'verschillende kopers', items: 'codes en top-ups geleverd',
  reviews: 'geverifieerde reviews', referrals: 'vrienden die via een vriend bestelden', checkins: 'dagelijkse check-ins',
};
export function milestonesFrom(counts) {
  return Object.entries(counts).map(([id, n]) => {
    const reached = [...MILESTONE_STEPS].reverse().find((t) => n >= t) || null;
    const next = MILESTONE_STEPS.find((t) => t > n) || null;
    return { id, label: MILESTONE_LABEL[id], count: n, reached, next, progress: next ? Math.round((n / next) * 100) : 100 };
  });
}
/** For the public: only milestones the shop has actually passed — a "3 of 10"
    bar in public reads as an empty shop, and nothing is padded to avoid it. */
export async function publicMilestones() {
  return milestonesFrom(await milestoneCounts()).filter((m) => m.reached);
}

/* ── The owner's dashboard: distributions, never a ranking of named people ─ */
export async function communityDashboard({ now = new Date() } = {}) {
  const F = await loadFacts();
  const ids = new Set([...F.orders.keys(), ...F.reviews.keys(), ...F.referrals.keys(), ...F.streaks.keys(), ...F.discord.keys()]);
  const users = await get(`SELECT COUNT(*) AS n FROM users`).catch(() => ({ n: 0 }));
  const levelDist = Object.fromEntries(LEVELS.map((l) => [l.level, 0]));
  const refDist = Object.fromEntries(REFERRAL_LEVELS.map((l) => [l.id, 0]));
  const awardCount = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 0]));
  const recent = [];
  let xpTotal = 0, activeStreaks = 0, longestStreak = 0, monthStreakers = 0;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  for (const id of ids) {
    const s = statsFor(id, F, { now });
    const xp = xpFor(s).total;
    xpTotal += xp;
    levelDist[levelFor(xp).level] += 1;
    refDist[referralLevelFor(s.referrals).id] += 1;
    if (s.dailyCurrent > 0) activeStreaks += 1;
    longestStreak = Math.max(longestStreak, s.dailyLongest);
    if (s.monthStreak >= 2) monthStreakers += 1;
    for (const a of awardsFor(s)) {
      if (!a.earned) continue;
      awardCount[a.id] += 1;
      if (a.earnedAt && new Date(a.earnedAt).getTime() >= weekAgo) recent.push({ id: a.id, name: a.name, icon: a.icon, at: a.earnedAt });
    }
  }
  return {
    users: Number(users?.n || 0), participants: ids.size, xpTotal,
    avgXp: ids.size ? Math.round(xpTotal / ids.size) : 0,
    levels: LEVELS.map((l) => ({ ...l, users: levelDist[l.level] })),
    referralLevels: REFERRAL_LEVELS.map((l) => ({ ...l, users: refDist[l.id] })),
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, kind: a.kind, group: a.group, icon: a.icon, name: a.name, desc: a.desc, earnedBy: awardCount[a.id] })),
    streaks: { activeDaily: activeStreaks, longestDaily: longestStreak, monthStreakers },
    /* Earned in the last 7 days: which award, when — not who. */
    recent: recent.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25),
    milestones: milestonesFrom(await milestoneCounts()),
    xpRules: XP_RULES,
  };
}
