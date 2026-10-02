/**
 * A bot that starts late must not post a month of stale news.
 *
 * Undelivered events waited up to thirty days, so the first start of the bot —
 * which has been offline for weeks — would have posted every queued drop,
 * restock, delivery proof and review in one burst, pinging opted-in members
 * for products long sold out. Each kind now has its own shelf life; past it, an
 * event is retired unsent. Staff order pings keep the full thirty days.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, all } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const discord = await import('../src/services/discordService.js');

const H = 3_600_000;
async function queued(kind, hoursAgo) {
  const id = newId('dob');
  await run(`INSERT INTO discord_outbox (id, kind, payload, created_at) VALUES (@id, @k, @p, @at)`,
    { id, k: kind, p: JSON.stringify({ content: `${kind} ${hoursAgo}h` }), at: new Date(Date.now() - hoursAgo * H).toISOString() });
  return id;
}

await run('DELETE FROM discord_outbox');
const fresh = {
  deals: await queued('deals', 2), proof: await queued('proof', 20), reviews: await queued('reviews', 100),
  dm: await queued('dm', 48), alerts: await queued('alerts', 100), leads: await queued('leads', 24 * 20),
};
const stale = {
  deals: await queued('deals', 30), proof: await queued('proof', 60), reviews: await queued('reviews', 200),
  dm: await queued('dm', 80), alerts: await queued('alerts', 200),
};

const out = await discord.claimOutbox(50);
const ids = new Set(out.map((e) => e.id));
const left = new Set((await all('SELECT id FROM discord_outbox')).map((r) => r.id));

console.log('\n— What is still worth posting goes out —');
for (const [k, id] of Object.entries(fresh)) ok(`${k}, still fresh, is offered to the bot`, ids.has(id));
ok('a paid-order ping three weeks late is still offered — staff would rather hear late', ids.has(fresh.leads));

console.log('\n— What is not, is retired unsent —');
for (const [k, id] of Object.entries(stale)) ok(`${k}, past its shelf life, is never posted`, !ids.has(id) && !left.has(id));
ok('a drop is news for a day', discord.OUTBOX_FRESH_HOURS.deals === 24);
ok('nothing waits longer than the thirty-day retention', Object.values(discord.OUTBOX_FRESH_HOURS).every((h) => h <= 30 * 24));

console.log(`\n${fail ? '❌' : '✅'} discord-outbox-fresh: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
