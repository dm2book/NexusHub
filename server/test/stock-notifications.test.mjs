/**
 * Restock and low-stock notifications, driven by real concurrent purchases.
 *
 * The ladder itself was already carefully built — one alert per tier per stock
 * cycle, claimed with a single conditional UPDATE so two orders crossing the
 * same threshold at the same moment cannot both send. This proves that rather
 * than trusting it, because "only one caller wins" is exactly the kind of claim
 * that is true until someone reorders two lines.
 *
 * What was missing was the other half: which people get told. #roles has
 * offered a self-assignable role per game since the server was built and
 * nothing ever pinged one — every restock went to everyone who opted into any
 * drop at all, so somebody who only buys Robux was pinged for every Steam
 * restock. That is how an opt-in role becomes an opt-out.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_stock_notify';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 3500));
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const cs = await import('../src/services/codeStockService.js');

/* Every alert this run would send, caught at the queue. Both paths end in the
   outbox when no webhook is configured, which is the documented setup. */
const alertsFor = async (name) => (await all(
  `SELECT kind, payload FROM discord_outbox ORDER BY created_at`))
  .filter((r) => (r.payload || '').includes(name));

async function product(name, { codes = 0, category = 'robux' } = {}) {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@s,@n,@c,'t',999,'EUR','digital',1,'{}',@at,@at)`,
    { id, s: `S-${id.slice(-8)}`, n: name, c: category, at: nowIso() });
  if (codes) await cs.addProductCodes(id, Array.from({ length: codes }, (_, i) => `${name}-C${i}`));
  return id;
}
/** Consume n codes the way a paid order does — against a real order row. */
async function buy(pid, n) {
  const oid = newId('ord');
  await run(`INSERT INTO orders (id, number, email, status, total, currency, created_at, updated_at)
             VALUES (@id,@num,'buyer@example.com','completed',999,'EUR',@at,@at)`,
    { id: oid, num: `FM-S-${oid.slice(-6)}`, at: nowIso() });
  return cs.claimCodes(pid, n, oid);
}

console.log('— The ladder —');
{
  ok('the tiers are configured', Array.isArray(config.stock.alertTiers) && config.stock.alertTiers.length > 0,
    JSON.stringify(config.stock.alertTiers));
  ok('they run most-severe-last', [...config.stock.alertTiers].every(
    (t, i, a) => i === 0 || a[i - 1] >= t), JSON.stringify(config.stock.alertTiers));
  ok('a comfortable count is not an alert', cs.stockTierFor(50) === null);
  ok('crossing ten is', cs.stockTierFor(9) === 10, `${cs.stockTierFor(9)}`);
  ok('crossing five reports five, not ten', cs.stockTierFor(4) === 5, `${cs.stockTierFor(4)}`);
  ok('empty is exactly zero', cs.stockTierFor(0) === 0);
  ok('…and "nearly out" is a different statement from "out"', cs.stockTierFor(1) === 5);
}

console.log('\n— One alert per rung, however many orders cross it —');
{
  await run(`DELETE FROM discord_outbox`);
  const p = await product('LadderProduct', { codes: 12 });
  await run(`DELETE FROM discord_outbox`);   // drop the restock announcement

  await buy(p, 3);                            // 12 → 9, crosses 10
  await Promise.all([cs.checkLowStock(p), cs.checkLowStock(p), cs.checkLowStock(p)]);
  let seen = await alertsFor('LadderProduct');
  ok('crossing ten alerts once, even from three simultaneous checks',
    seen.length === 1, `${seen.length}`);

  await cs.checkLowStock(p);
  seen = await alertsFor('LadderProduct');
  ok('and checking again at the same level says nothing more', seen.length === 1, `${seen.length}`);

  await buy(p, 5);                            // 9 → 4, crosses 5
  await cs.checkLowStock(p);
  seen = await alertsFor('LadderProduct');
  ok('crossing five is a new rung, so it does speak', seen.length === 2, `${seen.length}`);

  await buy(p, 4);                            // 4 → 0
  await cs.checkLowStock(p);
  seen = await alertsFor('LadderProduct');
  ok('running out is the last rung', seen.length === 3, `${seen.length}`);
  ok('…and it says out of stock', seen.some((r) => /out of stock/i.test(r.payload)),
    seen.map((r) => r.payload.slice(0, 60)).join(' | '));
  await cs.checkLowStock(p);
  ok('an empty shelf does not keep announcing itself',
    (await alertsFor('LadderProduct')).length === 3);
}

console.log('\n— Two buyers hitting the last codes at the same instant —');
{
  await run(`DELETE FROM discord_outbox`);
  const p = await product('RaceProduct', { codes: 6 });
  await run(`DELETE FROM discord_outbox`);

  // Six codes, two buyers taking three each — both land on the far side of five.
  const [a, b] = await Promise.all([buy(p, 3), buy(p, 3)]);
  ok('every code went out exactly once', a.length + b.length === 6, `${a.length}+${b.length}`);
  ok('and no code went to both', new Set([...a, ...b]).size === 6);
  ok('the shelf is empty', (await cs.availableCount(p)) === 0);

  await Promise.all([cs.checkLowStock(p), cs.checkLowStock(p)]);
  const seen = await alertsFor('RaceProduct');
  /* Both buyers crossed 10 and 5 and landed on 0 in the same moment. The most
     severe rung wins — the owner wants to know where the stock IS, not to be
     walked down the ladder after the fact. */
  ok('two simultaneous crossings produce one alert, not two', seen.length === 1, `${seen.length}`);
  ok('…and it reports the level they actually landed on',
    /out of stock/i.test(seen[0]?.payload || ''), (seen[0]?.payload || '').slice(0, 80));
}

console.log('\n— A restock rearms every rung —');
{
  await run(`DELETE FROM discord_outbox`);
  const p = await product('RearmProduct', { codes: 6 });
  await run(`DELETE FROM discord_outbox`);
  await buy(p, 6);
  await cs.checkLowStock(p);
  ok('it announced running out', (await alertsFor('RearmProduct')).length === 1);

  const before = await get(`SELECT low_stock_alert_level FROM products WHERE id=@p`, { p });
  ok('the rung it reached is recorded', before.low_stock_alert_level === 0,
    String(before.low_stock_alert_level));

  await cs.addProductCodes(p, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12']);
  const after = await get(`SELECT low_stock_alert_level, low_stock_alerted_at FROM products WHERE id=@p`, { p });
  ok('a restock clears the ladder',
    after.low_stock_alert_level === null && after.low_stock_alerted_at === null,
    JSON.stringify(after));
  ok('…and announces the restock', (await alertsFor('RearmProduct')).some(
    (r) => /Restocked/.test(r.payload)));

  // And the whole ladder can be walked again.
  await buy(p, 3);
  await cs.checkLowStock(p);
  ok('the low rung fires again after a restock',
    (await alertsFor('RearmProduct')).some((r) => /below the 10 mark/.test(r.payload)),
    'the rearmed ladder stayed silent');
}

console.log('\n— The state is in the database, so a restart changes nothing —');
{
  const p = await product('RestartProduct', { codes: 8 });
  await buy(p, 1);
  await cs.checkLowStock(p);
  const row = await get(
    `SELECT low_stock_alert_level, low_stock_alerted_at FROM products WHERE id=@p`, { p });
  ok('the rung survives outside any process', row.low_stock_alert_level === 10,
    String(row.low_stock_alert_level));
  ok('…with the moment it happened', !!row.low_stock_alerted_at);

  /* Nothing is memoised in the module — the ladder is a column, not a Map — so
     a freshly loaded copy of the service asks the same database and gets the
     same "already announced". Counting low-stock alerts only: the restock that
     put the codes there is a separate, legitimate announcement. */
  const lowAlerts = async () => (await alertsFor('RestartProduct'))
    .filter((r) => /below the \d+ mark|out of stock/i.test(r.payload)).length;
  const before = await lowAlerts();
  ok('it announced the low rung once', before === 1, `${before}`);
  const fresh = await import(`../src/services/codeStockService.js?restart=${Date.now()}`);
  await fresh.checkLowStock(p);
  ok('a freshly loaded module does not re-announce it', (await lowAlerts()) === 1,
    `${await lowAlerts()}`);
}

console.log('\n— A restock reaches the people who asked about that game —');
{
  await run(`DELETE FROM discord_outbox`);
  const p = await product('RobuxRestock', { codes: 5, category: 'robux' });
  const ev = (await alertsFor('RobuxRestock'))[0];
  ok('the restock is queued for the community', !!ev, 'nothing queued');
  const body = JSON.parse(ev.payload);
  ok('…carrying the product’s category', body.fmPing?.category === 'robux',
    JSON.stringify(body.fmPing));

  const { CATEGORY_GAME_ROLE, GAME_ROLES } = await import('../../discord/src/config.js');
  const key = CATEGORY_GAME_ROLE[body.fmPing.category];
  ok('…which maps to a role members can actually pick',
    !!GAME_ROLES.find((g) => g.key === key), `${body.fmPing.category} → ${key}`);

  /* Every mapping must point at a role that exists in #roles, or the ping
     silently reaches nobody. */
  const roleKeys = new Set(GAME_ROLES.map((g) => g.key));
  const dangling = Object.entries(CATEGORY_GAME_ROLE).filter(([, v]) => !roleKeys.has(v));
  ok('no category points at a role that does not exist', dangling.length === 0,
    JSON.stringify(dangling));

  // A category nobody has a role for still reaches the broad Drops role.
  const q = await product('ObscureRestock', { codes: 2, category: 'albion' });
  const ev2 = (await alertsFor('ObscureRestock'))[0];
  const body2 = JSON.parse(ev2.payload);
  ok('an unmapped category still announces', !!ev2);
  ok('…and simply names no game role', !CATEGORY_GAME_ROLE[body2.fmPing?.category || '']);
}

console.log('\n— Staff alerts stay with staff —');
{
  const bot = (await import('node:fs')).readFileSync(
    new URL('../../discord/src/bot.js', import.meta.url), 'utf8');
  ok('only the deals channel pings members', /OUTBOX_PING = \{ deals:/.test(bot));
  ok('the game role is added to that ping, not a second message',
    /const game = gameRoleFor\(guild, ev\.body\)/.test(bot));
  ok('roles are de-duplicated before mentioning', /new Set\(pingRoles\.map/.test(bot));
  ok('mentions are constrained to those roles', /allowedMentions: \{ roles: pingIds \}/.test(bot));
  ok('our own routing field never reaches Discord',
    /const \{ fmPing, \.\.\.payload \} = ev\.body/.test(bot));

  const svc = (await import('node:fs')).readFileSync(
    new URL('../src/services/discordService.js', import.meta.url), 'utf8');
  ok('…nor the webhook path', /const \{ fmPing, \.\.\.forDiscord \} = body/.test(svc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
