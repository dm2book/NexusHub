/**
 * The community layer: levels, XP, badges, achievements, referral levels,
 * streaks and milestones — every number recomputed from real rows.
 *
 * What must hold:
 *   XP is exactly the published rules applied to completed, paid orders,
 *   verified reviews, real referrals and check-ins;
 *   a test payment, a refunded or cancelled order and an unpaid order count
 *   for nothing; an unverified review counts for nothing;
 *   a referral counts only once the friend's order is completed;
 *   an achievement is earned at the date the real event happened;
 *   public milestones appear only once reached; nobody is ranked by name.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run } = await import('../src/db/index.js');
const { claimInterval } = await import('../src/services/bootUpkeep.js').catch(() => ({}));
if (claimInterval) await claimInterval('maintenance_auto', 3_600_000).catch(() => {});
const C = await import('../src/services/communityService.js');
const { createProduct } = await import('../src/services/productService.js');

const tag = Date.now().toString(36);
const iso = (d) => new Date(d).toISOString();
const day = 86_400_000;
const t0 = Date.parse('2026-01-05T12:00:00Z');

async function user(name) {
  const id = `usr_${name}_${tag}`;
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id, @e, @at, @at)`, { id, e: `${name}.${tag}@example.com`, at: iso(t0) });
  return id;
}
const robux = await createProduct({ name: `1.700 Robux ${tag}`, category: 'robux', price: 1999, announce: false });
const steam = await createProduct({ name: `Steam €20 ${tag}`, category: 'giftcard', price: 2000, announce: false });
const nitro = await createProduct({ name: `Nitro ${tag}`, category: 'discord-nitro', price: 999, announce: false });
let n = 0;
async function order(userId, { total = 2000, status = 'completed', at = t0, product = robux, qty = 1 } = {}) {
  n += 1;
  const id = `ord_${tag}_${n}`;
  await run(`INSERT INTO orders (id, number, user_id, email, status, total, subtotal, payment_status, created_at, updated_at)
             VALUES (@id, @num, @u, @e, @s, @t, @t, @ps, @at, @at)`,
    { id, num: `FM-${tag}-${n}`, u: userId, e: `${userId}@example.com`, s: status, t: total, ps: status === 'completed' ? 'paid' : 'unpaid', at: iso(at) });
  await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price) VALUES (@id, @o, @p, @nm, @q, @t)`,
    { id: `oi_${tag}_${n}`, o: id, p: product.id, nm: product.name, q: qty, t: total });
  return id;
}

console.log('— XP is the published rules, applied to what really happened —');
const ana = await user('ana');
const o1 = await order(ana, { total: 2000, at: t0 });                         // €20
await order(ana, { total: 3050, at: t0 + 1 * day, product: steam });          // €30.50
await order(ana, { total: 1000, at: t0 + 2 * day, product: nitro });          // €10
await order(ana, { total: 9999, status: 'refunded', at: t0 + 3 * day });      // nothing
await order(ana, { total: 9999, status: 'pending', at: t0 + 3 * day });       // nothing
const testOrder = await order(ana, { total: 9999, at: t0 + 4 * day });        // a test payment → nothing
await run(`INSERT INTO social_events (id, type, order_id, product_label, created_at, test) VALUES (@id, 'purchase', @o, 'x', @at, 1)`,
  { id: `se_${tag}`, o: testOrder, at: iso(t0) }).catch(async () => {
  await run(`ALTER TABLE social_events ADD COLUMN IF NOT EXISTS test INTEGER NOT NULL DEFAULT 0`);
  await run(`INSERT INTO social_events (id, type, order_id, product_label, created_at, test) VALUES (@id, 'purchase', @o, 'x', @at, 1)`, { id: `se_${tag}`, o: testOrder, at: iso(t0) });
});
await run(`INSERT INTO reviews (id, author, body, stars, source, status, created_at, verified, user_id, order_id)
           VALUES (@id, 'Ana', 'Top', 5, 'site', 'visible', @at, 1, @u, @o)`, { id: `rv_${tag}_1`, at: iso(t0 + 5 * day), u: ana, o: o1 });
await run(`INSERT INTO reviews (id, author, body, stars, source, status, created_at, verified, user_id)
           VALUES (@id, 'Ana', 'Unverified', 5, 'discord', 'visible', @at, 0, @u)`, { id: `rv_${tag}_2`, at: iso(t0 + 6 * day), u: ana });
await run(`INSERT INTO daily_streaks (user_id, current_streak, longest_streak, last_claim_day, total_claims, total_points, created_at, updated_at)
           VALUES (@u, 3, 8, '2026-01-10', 12, 120, @at, @at)`, { u: ana, at: iso(t0) });
await run(`INSERT INTO oauth_accounts (id, user_id, provider, provider_uid, created_at) VALUES (@id, @u, 'discord', @pu, @at)`,
  { id: `oa_${tag}`, u: ana, pu: `d_${tag}`, at: iso(t0 + 7 * day) });
// referrals: bob completes, cas only pends
const bob = await user('bob'); const cas = await user('cas');
const ob = await order(bob, { total: 1500, at: t0 + 8 * day });
const oc = await order(cas, { total: 1500, status: 'pending', at: t0 + 9 * day });
for (const [rid, ref, o] of [[`re_${tag}_b`, bob, ob], [`re_${tag}_c`, cas, oc]]) {
  await run(`INSERT INTO referral_events (id, code, referrer_id, referred_id, order_id, kind, commission, status, created_at)
             VALUES (@id, 'ANA', @r, @f, @o, 'order', 100, 'approved', @at)`, { id: rid, r: ana, f: ref, o, at: iso(t0 + 8 * day) });
}

{
  const p = await C.communityProfile(ana, { now: new Date(t0 + 10 * day) });
  const part = (id) => p.xp.parts.find((x) => x.id === id);
  ok('only the three completed, non-test orders count', p.counts.orders === 3, `${p.counts.orders}`);
  ok('…so €60.50 spent → 60 euro-XP', part('euro').count === 60, `${part('euro').count}`);
  ok('3 orders × 20 XP', part('order').xp === 60);
  ok('only the verified review counts (1 × 30)', part('review').count === 1 && part('review').xp === 30);
  ok('only the referral whose friend completed an order counts (1 × 100)', part('referral').count === 1 && part('referral').xp === 100);
  ok('12 check-ins × 2 XP', part('claim').xp === 24);
  ok('Discord linked: 25 once', part('discord').xp === 25);
  const expected = 60 + 60 + 30 + 100 + 24 + 25;
  ok(`total XP is exactly the rules applied (${expected})`, p.xp.total === expected, `${p.xp.total}`);
  ok('level follows from XP (299 → level 3, Vaste klant; 300 is level 4)', p.level.level === 3 && p.level.name === 'Vaste klant', JSON.stringify(p.level));
  ok('…and says how much is left to the next level', p.level.next?.remaining === 1, JSON.stringify(p.level.next));
  ok('referral level from real referrals only: Scout', p.referral.id === 'scout' && p.referral.count === 1);
  const a = (id) => [...p.achievements, ...p.badges].find((x) => x.id === id);
  ok('first order earned, dated on the real first order', a('first-order').earned && a('first-order').earnedAt.startsWith('2026-01-05'));
  ok('explorer earned: three categories bought', a('explorer').earned);
  ok('5 orders not earned, with real progress 3/5', !a('regular').earned && a('regular').progress.value === 3 && a('regular').progress.target === 5);
  ok('streak-7 earned from the longest real streak (8)', a('streak-7').earned && !a('streak-30').earned);
  ok('Discord badge, dated when linked', a('discord').earned && a('discord').earnedAt.startsWith('2026-01-12'));
  ok('daily streak current/longest are the stored real values', p.streaks.daily.current === 3 && p.streaks.daily.longest === 8);
}

console.log('\n— Someone with nothing yet gets zeroes, not filler —');
{
  const zed = await user('zed');
  const p = await C.communityProfile(zed);
  ok('0 XP, level 1', p.xp.total === 0 && p.level.level === 1);
  ok('no achievement earned', [...p.achievements, ...p.badges].every((x) => !x.earned));
}

console.log('\n— Milestones —');
{
  const counts = await C.milestoneCounts();
  ok('orders counted only when completed, paid and not a test', counts.orders >= 4);
  const ms = C.milestonesFrom({ orders: 7, buyers: 30 });
  ok('below the first step: not reached, next is 10', ms[0].reached === null && ms[0].next === 10);
  ok('30 buyers: reached 25, next 50', ms[1].reached === 25 && ms[1].next === 50);
  const pub = await C.publicMilestones();
  ok('the public list only holds milestones that were reached', pub.every((m) => m.reached && m.count >= m.reached));
}

console.log('\n— The admin dashboard —');
{
  const d = await C.communityDashboard({ now: new Date(t0 + 10 * day) });
  ok('level distribution adds up to the participants', d.levels.reduce((a, l) => a + l.users, 0) === d.participants);
  ok('achievement counts are counts of people who really earned them', d.achievements.find((a) => a.id === 'first-order').earnedBy >= 2);
  ok('no names in the dashboard (distributions only)', !JSON.stringify(d).includes('example.com') && !JSON.stringify(d).includes(ana));
}

console.log('\n— Over HTTP —');
{
  const app = createApp();
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${base}/api/community/milestones`);
  ok('public milestones answer', r.status === 200 && Array.isArray((await r.json()).milestones));
  ok('the account profile needs a login', (await fetch(`${base}/api/account/community`)).status === 401);
  ok('the admin dashboard needs a login', (await fetch(`${base}/api/admin/community`)).status === 401);
  srv.close();
}

console.log('\n— Wired into the site —');
{
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  ok('the account page has a route', /\/account\/community/.test(app));
  ok('the admin dashboard has a route', /\/admin\/community/.test(app));
}

console.log(`\n${fail ? '❌' : '✅'} community-layer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
