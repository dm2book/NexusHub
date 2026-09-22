/**
 * A weekly copy of everything that cannot be re-derived.
 *
 * ── WHAT THIS PROTECTS AGAINST, AND WHAT IT DOES NOT ──────────────────────
 * Stated first because a backup that is misunderstood is worse than none.
 *
 * It protects against MISTAKES: a bulk edit that wiped forty descriptions, a
 * product deleted by the wrong click, a batch of codes emptied by somebody who
 * reached the admin. Those are the losses a hosted database's own snapshots
 * will happily replicate for you.
 *
 * It does NOT, on its own, protect against losing the database — it lives in
 * the database it is copying. That is why every snapshot records whether it has
 * been downloaded, and why the admin says so: the off-site copy is the one the
 * owner takes, and nothing here can take it for them.
 *
 * ── WHAT IS IN IT ─────────────────────────────────────────────────────────
 * The rows nobody can reconstruct: the catalogue with its cost prices, the
 * unused codes (which are money), orders and their items, customers, coupons,
 * gift cards, the settings an owner typed in. Not the derived ones — page
 * views, audit logs, market observations and email logs are large, rebuildable
 * or replaceable, and putting them in turns a 2 MB file into a 200 MB one.
 *
 * ── WHAT IS DELIBERATELY LEFT OUT ─────────────────────────────────────────
 * `app_secrets` — never. A backup is a file that gets downloaded, mailed and
 * forgotten on a laptop, and the whole point of keeping the Stripe key
 * encrypted under an environment variable is that a copy of the database is not
 * a copy of the key. Supplier configs carry API tokens in the same way, so
 * those are redacted field by field rather than excluded, because the rest of
 * the row — which supplier, which products, which markup — is worth keeping.
 *
 * Customer rows ARE included: a restore without them is not a restore. That
 * makes a downloaded snapshot a file of personal data, which is the owner's to
 * handle, and the admin says so where they download it.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { all, get, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { audit } from './auditService.js';

/** Hard ceiling. Past this, a real database backup is the right tool. */
export const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The tables a restore needs, in an order a restore could replay.
 *
 * `redact` names columns whose contents are credentials rather than data. They
 * are replaced, not dropped, so a restored row still says a supplier was
 * configured — with the key blanked, which is the only safe half.
 */
export const TABLES = [
  { name: 'products' },
  { name: 'product_codes' },
  { name: 'categories_note', skip: true },
  { name: 'orders' },
  { name: 'order_items' },
  { name: 'users' },
  { name: 'coupons' },
  { name: 'gift_cards' },
  { name: 'bundles' },
  { name: 'forge_shop_items' },
  { name: 'forge_coin_ledger' },
  { name: 'daily_streaks' },
  { name: 'daily_claims' },
  { name: 'daily_reward_rules' },
  { name: 'suppliers', redact: ['config', 'credentials_ref'] },
  { name: 'supplier_products' },
  { name: 'kv' },
  { name: 'reviews' },
  { name: 'referral_events' },
].filter((t) => !t.skip);

/** Which kv keys are settings worth keeping and which are job bookkeeping. */
const KV_SKIP = /^(market\.job\.|maintenance_last_run|discord_bot_seen_at)/;

async function tableRows(t) {
  const rows = await all(`SELECT * FROM ${t.name}`).catch(() => null);
  if (!rows) return null;                       // table not in this schema yet
  if (t.name === 'kv') return rows.filter((r) => !KV_SKIP.test(String(r.key || '')));
  if (!t.redact?.length) return rows;
  return rows.map((r) => {
    const copy = { ...r };
    for (const col of t.redact) {
      if (copy[col]) copy[col] = '[redacted: credentials are not backed up]';
    }
    return copy;
  });
}

/**
 * Take a snapshot.
 *
 * Gzipped JSON in one row. A dump this size is not worth a file store, an
 * upload credential and a second failure mode; it is worth being there when
 * somebody deletes the wrong thing.
 */
export async function takeBackup({ actor = null, reason = 'scheduled' } = {}) {
  const at = nowIso();
  const data = {};
  const counts = {};
  const skipped = [];

  for (const t of TABLES) {
    const rows = await tableRows(t);
    if (rows === null) { skipped.push(t.name); continue; }
    data[t.name] = rows;
    counts[t.name] = rows.length;
  }

  const json = JSON.stringify({ takenAt: at, schema: 1, counts, data });
  const payload = gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
  const bytes = Buffer.byteLength(payload, 'utf8');

  if (bytes > MAX_BYTES) {
    /* Refused rather than truncated. Half a backup restores half a shop, and
       nobody finds out which half until they need it. */
    const err = new Error(
      `This shop is now ${(bytes / 1048576).toFixed(1)} MB compressed, past the `
      + `${MAX_BYTES / 1048576} MB this is built for. Use your database provider's own `
      + 'backups — Neon keeps point-in-time restore — rather than a copy inside the database.');
    err.status = 413;
    throw err;
  }

  const id = newId('bkp');
  await run(
    `INSERT INTO backups (id, kind, byte_size, counts, payload, reason, created_at)
     VALUES (@id, 'shop', @b, @c, @p, @r, @at)`,
    { id, b: bytes, c: JSON.stringify(counts), p: payload, r: reason, at });

  /* Four kept. A fifth copy of a mistake is not more protection, and each one
     is megabytes in a database billed by the hour. */
  const old = await all(
    `SELECT id FROM backups WHERE kind='shop' ORDER BY created_at DESC OFFSET 4`).catch(() => []);
  for (const o of old) await run(`DELETE FROM backups WHERE id=@id`, { id: o.id });

  await audit({ actor, action: 'backup.taken', targetType: 'backup', targetId: id,
    metadata: { bytes, counts, skipped, reason } });

  return { id, bytes, counts, skipped, takenAt: at, pruned: old.length };
}

/** The snapshots on hand — never their contents. */
export async function listBackups({ limit = 10 } = {}) {
  const rows = await all(
    `SELECT id, kind, byte_size, counts, reason, created_at, downloaded_at
       FROM backups ORDER BY created_at DESC LIMIT @l`, { l: limit }).catch(() => []);
  return rows.map((r) => {
    let counts = {};
    try { counts = JSON.parse(r.counts || '{}'); } catch { counts = {}; }
    return {
      id: r.id, kind: r.kind, bytes: Number(r.byte_size || 0), counts,
      rows: Object.values(counts).reduce((a, b) => a + Number(b || 0), 0),
      reason: r.reason, createdAt: r.created_at, downloadedAt: r.downloaded_at,
    };
  });
}

/**
 * The snapshot itself, and a note that it left the building.
 *
 * `downloaded_at` is the only evidence that an off-site copy exists at all, so
 * it is written here rather than inferred — and it is what the readiness line
 * reads when it says a shop has never taken one away.
 */
export async function readBackup(id, { actor = null } = {}) {
  const row = await get(`SELECT * FROM backups WHERE id=@id`, { id });
  if (!row) return null;
  await run(`UPDATE backups SET downloaded_at=@at WHERE id=@id`, { id, at: nowIso() });
  await audit({ actor, action: 'backup.downloaded', targetType: 'backup', targetId: id,
    metadata: { bytes: Number(row.byte_size || 0) } });
  return {
    id: row.id, kind: row.kind, createdAt: row.created_at,
    json: gunzipSync(Buffer.from(row.payload, 'base64')).toString('utf8'),
  };
}

/** How the shop is doing at keeping copies, in one sentence. */
export async function backupStatus({ everyDays = 7 } = {}) {
  const last = await get(
    `SELECT created_at, byte_size, downloaded_at FROM backups WHERE kind='shop'
      ORDER BY created_at DESC LIMIT 1`).catch(() => null);
  const everTaken = await get(
    `SELECT MAX(downloaded_at) AS at FROM backups`).catch(() => null);

  if (!last) {
    return { status: 'warn', hasBackup: false,
      detail: 'No snapshot has been taken yet. The weekly sweep takes one; until then a '
        + 'mistaken bulk edit has nothing to be undone from.' };
  }
  const ageDays = (Date.now() - Date.parse(last.created_at)) / 86_400_000;
  const stale = ageDays > everyDays * 2;
  const offsite = everTaken?.at ? (Date.now() - Date.parse(everTaken.at)) / 86_400_000 : null;

  return {
    status: stale ? 'warn' : 'ok',
    hasBackup: true,
    ageDays: Math.round(ageDays * 10) / 10,
    bytes: Number(last.byte_size || 0),
    offsiteDaysAgo: offsite == null ? null : Math.round(offsite * 10) / 10,
    detail: stale
      ? `The newest snapshot is ${Math.round(ageDays)} days old, and one is meant to be taken `
        + `every ${everyDays}. The maintenance sweep is what takes them, so check it is running.`
      : `Snapshot ${Math.round(ageDays * 10) / 10} days old (${(Number(last.byte_size) / 1024).toFixed(0)} KB). `
        + (offsite == null
          /* Said plainly, because it is the part people get wrong: a copy inside
             the database is not a copy of the database. */
          ? 'None has ever been downloaded — every copy is still inside the same database it is backing up.'
          : `Last downloaded ${Math.round(offsite)} day(s) ago.`),
  };
}

/* ── The Discord server's shape ──────────────────────────────────────────── */

/**
 * Keep a copy of the structure the bot sent.
 *
 * Channels, roles and their order — the thing that takes an evening to rebuild
 * after a deletion, and that nobody has written down anywhere. Not messages:
 * those are Discord's, they are enormous, and a shop has no business holding a
 * community's conversations in its own database.
 *
 * Two kept rather than four. This changes rarely, and an old copy of a server
 * shape is a plan for rebuilding a server that no longer exists.
 */
export async function storeGuildBackup(snapshot, { guildId = null } = {}) {
  const json = JSON.stringify({ takenAt: nowIso(), schema: 1, guildId, snapshot });
  const payload = gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
  const bytes = Buffer.byteLength(payload, 'utf8');
  if (bytes > MAX_BYTES) {
    const err = new Error('That Discord snapshot is too large to store.');
    err.status = 413;
    throw err;
  }

  const counts = {
    channels: Array.isArray(snapshot.channels) ? snapshot.channels.length : 0,
    roles: Array.isArray(snapshot.roles) ? snapshot.roles.length : 0,
  };
  const id = newId('bkp');
  const at = nowIso();
  await run(
    `INSERT INTO backups (id, kind, byte_size, counts, payload, reason, created_at)
     VALUES (@id, 'discord', @b, @c, @p, 'bot', @at)`,
    { id, b: bytes, c: JSON.stringify(counts), p: payload, at });

  const old = await all(
    `SELECT id FROM backups WHERE kind='discord' ORDER BY created_at DESC OFFSET 2`).catch(() => []);
  for (const o of old) await run(`DELETE FROM backups WHERE id=@id`, { id: o.id });

  return { id, bytes, counts };
}
