/**
 * Somewhere to shout, and something to restore from.
 *
 * ── THE TWO GAPS ──────────────────────────────────────────────────────────
 * A one-person shop had no instant alert channel, so a chargeback at 3am
 * arrived by email; and it had no copy of anything, so a bulk edit that wiped
 * forty descriptions had nothing to be undone from. A hosted database's own
 * snapshots do not help with the second: they replicate the mistake faithfully,
 * taken a second later.
 *
 * ── WHAT THESE ASSERTIONS ARE MOSTLY ABOUT ────────────────────────────────
 * Not that a backup happens — that is easy — but that it is honest about what
 * it is. A copy living in the database it copies is not protection from losing
 * that database, and a screen that implies otherwise is worse than no screen.
 * And a backup is a file that gets downloaded and forgotten on a laptop, so
 * what is NOT in it matters more than what is.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
process.env.JWT_SECRET ||= 'test-secret-for-backups-0123456789abcdef';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const backups = await import('../src/services/backupService.js');
const { all, get, run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { setSecret } = await import('../src/services/secretStore.js');

const STAFF = { id: 'usr_staff', email: 'owner@forgemarket.nl' };
const gunzip = (await import('node:zlib')).gunzipSync;

console.log('\n— A copy of what cannot be rebuilt —');
{
  const p = await createProduct({
    name: 'Backup Test Pack', sku: `BKP-${Date.now()}`, category: 'robux',
    price: 999, currency: 'EUR', active: true, announce: false, metadata: { cost: 500 },
  });
  await addProductCodes(p.id, ['BACKUP-CODE-ONE', 'BACKUP-CODE-TWO']);

  const b = await backups.takeBackup({ actor: STAFF, reason: 'test' });
  ok('a snapshot is taken', !!b.id && b.bytes > 0, JSON.stringify({ id: b.id, bytes: b.bytes }));
  ok('…and counts what it holds', b.counts.products >= 1 && b.counts.product_codes >= 2,
    JSON.stringify(b.counts));

  const read = await backups.readBackup(b.id, { actor: STAFF });
  const data = JSON.parse(read.json).data;
  ok('the catalogue is in it', data.products.some((x) => x.id === p.id));
  /* Unused codes ARE money, and they are the thing a restore most needs. */
  ok('…and the unused codes are too',
    data.product_codes.filter((c) => c.product_id === p.id).length === 2,
    String(data.product_codes.length));
  /* metadata is a JSON string inside the row, so it arrives escaped — reading
     it as text finds nothing and proves nothing. */
  const backedUp = data.products.find((x) => x.id === p.id);
  const meta = typeof backedUp.metadata === 'string'
    ? JSON.parse(backedUp.metadata) : (backedUp.metadata || {});
  ok('…with the cost price, which nobody can re-derive', meta.cost === 500,
    JSON.stringify(backedUp.metadata));
}

console.log('\n— And what is deliberately NOT in it —');
{
  await setSecret('stripe.secretKey', 'sk_live_MUSTNEVERBEBACKEDUP', { actor: STAFF });
  await run(
    `INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
     VALUES (@id, 'Kinguin', 'kinguin', 'active', @cfg, @at, @at)`,
    { id: newId('sup'), cfg: JSON.stringify({ apiKey: 'kinguin_SECRET_KEY_1234', autoDeliver: true }), at: nowIso() });

  const b = await backups.takeBackup({ actor: STAFF, reason: 'test' });
  const read = await backups.readBackup(b.id, { actor: STAFF });

  /* A backup is a file that gets downloaded, mailed and forgotten on a laptop.
     The whole point of encrypting the Stripe key under an environment variable
     is that a copy of the database is not a copy of the key. */
  ok('the Stripe key is nowhere in the snapshot',
    !read.json.includes('sk_live_MUSTNEVERBEBACKEDUP'));
  ok('…and neither is the app_secrets table', !/"app_secrets"/.test(read.json));
  /* A supplier row is worth keeping — which supplier, which products — but its
     token is a credential like any other. */
  ok('a supplier API key is redacted, not exported',
    !read.json.includes('kinguin_SECRET_KEY_1234')
    && /redacted: credentials are not backed up/.test(read.json));
  const data = JSON.parse(read.json).data;
  ok('…while the supplier itself is still there',
    data.suppliers.some((s) => s.name === 'Kinguin'), String(data.suppliers?.length));

  /* Big, rebuildable, or replaceable. Including them turns a 2 MB file into a
     200 MB one and buys nothing a restore needs. */
  for (const t of ['page_views', 'audit_logs', 'market_observations', 'email_log']) {
    ok(`${t} is left out`, !data[t]);
  }
}

console.log('\n— Honest about what it protects against —');
{
  const s = await backups.backupStatus();
  ok('the status knows a snapshot exists', s.hasBackup === true);
  /* The sentence that matters. A list of four snapshots nobody has ever taken
     away reads as safety and is not. */
  const fresh = await backups.takeBackup({ reason: 'test' });
  await run(`UPDATE backups SET downloaded_at = NULL`);
  const never = await backups.backupStatus();
  ok('it says when nothing has ever been downloaded',
    /None has ever been downloaded/.test(never.detail), never.detail);
  ok('…and names the reason that matters',
    /same database it is backing up/.test(never.detail), never.detail);

  await backups.readBackup(fresh.id, { actor: STAFF });
  const taken = await backups.backupStatus();
  ok('…and stops saying it once one is', !/never been downloaded/.test(taken.detail), taken.detail);

  /* A sweep that stopped running is the failure mode nobody notices. */
  await run(`UPDATE backups SET created_at = @old`, { old: new Date(Date.now() - 40 * 86_400_000).toISOString() });
  const stale = await backups.backupStatus({ everyDays: 7 });
  ok('a stale snapshot is a warning', stale.status === 'warn', stale.detail);
  ok('…pointing at the sweep that should have taken one', /maintenance sweep/.test(stale.detail));
}

console.log('\n— Four kept, not forty —');
{
  await run(`DELETE FROM backups`);
  for (let i = 0; i < 6; i++) await backups.takeBackup({ reason: `test-${i}` });
  const rows = await all(`SELECT id FROM backups WHERE kind='shop'`);
  /* Each is megabytes in a database billed by the hour, and a fifth copy of a
     mistake is not more protection. */
  ok('only four shop snapshots are kept', rows.length === 4, String(rows.length));
}

console.log('\n— The Discord server’s shape —');
{
  const out = await backups.storeGuildBackup({
    name: 'ForgeMarket', channels: [{ id: '1', name: 'deals' }, { id: '2', name: 'leads' }],
    roles: [{ id: 'r1', name: 'Member' }],
  }, { guildId: '999' });
  ok('a guild snapshot is stored', out.counts.channels === 2 && out.counts.roles === 1,
    JSON.stringify(out.counts));
  const listed = await backups.listBackups({ limit: 10 });
  ok('…and is listed apart from the shop data',
    listed.some((b) => b.kind === 'discord'), JSON.stringify(listed.map((b) => b.kind)));

  /* Two, because an old copy of a server shape is a plan for rebuilding a
     server that no longer exists. */
  for (let i = 0; i < 3; i++) {
    await backups.storeGuildBackup({ channels: [], roles: [] }, { guildId: '999' });
  }
  const kept = await all(`SELECT id FROM backups WHERE kind='discord'`);
  ok('only two Discord snapshots are kept', kept.length === 2, String(kept.length));
}

console.log('\n— Somewhere to shout —');
{
  const notify = await import('../src/services/notifyService.js');
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/services/notifyService.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  ok('the bot is one of the channels', /channels = \{[^}]*\bbot\b/.test(src), '');
  /* With both, the same alert lands twice in the same server, which is how
     people learn to ignore a channel. */
  ok('…and stands down when a webhook is configured',
    /function bot\([\s\S]{0,200}if \(discordTarget\(\)\) return null;/.test(src), '');

  const disc = (await import('node:fs')).readFileSync(
    new URL('../src/services/discordService.js', import.meta.url), 'utf8');
  /* A queue nobody drains looks configured and delivers nothing — worse than
     the email it replaced. */
  ok('the queue refuses itself when the bot is not running',
    /queueOwnerAlert[\s\S]{0,400}botSeenRecently\(24\)/.test(disc), '');

  ok('a backup event exists to alert on', !!notify.EVENTS['backup.taken']);
  ok('…at the lowest priority, because it is not an emergency',
    notify.EVENTS['backup.taken'].priority < 0);

  /* The bot's own channel map has to know where staff alerts go, and its
     fallback has to be a staff channel — an owner on an older bot must not be
     silently missing them. */
  const bot = (await import('node:fs')).readFileSync(
    new URL('../../discord/src/bot.js', import.meta.url), 'utf8');
  ok('the bot routes alerts to a staff channel',
    /alerts: \['alerts', 'staff-announcements', 'leads'\]/.test(bot), '');
  ok('…and an unknown kind still lands with staff',
    /OUTBOX_CHANNEL\[ev\.channel\] \|\| \['leads'\]/.test(bot), '');
}

console.log(`\n${fail ? '❌' : '✅'} backup-alerts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
