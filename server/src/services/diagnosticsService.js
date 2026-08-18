/**
 * Production health & self-diagnostics. Assumes nothing works — it actually
 * probes the database (connectivity, migrations, every key table) and reports the
 * real configured/connected state of email, SMS, storage and the job queue.
 *
 * GET /api/health          → is it alive? one SELECT 1, cheap enough to call often.
 * GET /api/health?tables=1 → also lists migrations and counts every key table.
 * GET /api/health?deep=1   → also runs a non-destructive write→read→update→delete
 *                            CRUD self-test against a dedicated health_probe table.
 *
 * The census used to be the DEFAULT, and the storefront footer calls this
 * endpoint on every page load to render its status dot. That made the cheapest
 * possible question — "are you up?" — cost thirteen serialized round trips and a
 * COUNT(*) over every important table, on every single page view. Measured, not
 * assumed. The full picture is still one query parameter away for the admin and
 * for anyone debugging; it is simply no longer what a visitor pays for.
 */
import { run, get, all, nowIso } from '../db/index.js';
import { config } from '../config/env.js';

const KEY_TABLES = [
  'users', 'products', 'orders', 'order_items', 'otp_codes', 'sms_verifications',
  'reviews', 'sessions', 'trusted_devices', 'login_attempts', 'payment_proofs',
];

async function probe(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function databaseHealth(deep, wantTables = false) {
  const started = Date.now();
  if (!config.db.url) {
    return { ok: false, status: 'not_configured',
      detail: 'DATABASE_URL is not set. Connect Neon Postgres in Vercel → Storage.' };
  }

  const ping = await probe(() => get('SELECT 1 AS ok'));
  if (!ping.ok) return { ok: false, status: 'down', error: ping.error, latencyMs: Date.now() - started };

  const wantsCensus = wantTables || deep;
  let migrations = null;
  const tables = {};
  if (wantsCensus) {
    migrations = await probe(async () =>
      (await all('SELECT id FROM schema_migrations ORDER BY id')).map((r) => r.id));

    /* Per-table existence + row counts, each guarded so one missing table is
       visible rather than fatal — but issued together. Eleven awaits in a for
       loop is eleven round trips end to end; this is one. */
    const counts = await Promise.all(KEY_TABLES.map((t) =>
      probe(async () => Number((await get(`SELECT COUNT(*) AS n FROM ${t}`)).n))));
    KEY_TABLES.forEach((t, i) => {
      tables[t] = counts[i].ok ? { ok: true, rows: counts[i].value } : { ok: false, error: counts[i].error };
    });
  }

  // Optional CRUD self-test (read/write/update/delete) on a throwaway table.
  let crud = null;
  if (deep) {
    crud = await probe(async () => {
      await run(`CREATE TABLE IF NOT EXISTS health_probe (id TEXT PRIMARY KEY, v TEXT, at TEXT)`);
      const id = `hp_${Date.now()}`;
      await run(`INSERT INTO health_probe (id, v, at) VALUES (@id, 'w', @at)`, { id, at: nowIso() });
      const read = await get(`SELECT v FROM health_probe WHERE id=@id`, { id });
      await run(`UPDATE health_probe SET v='u' WHERE id=@id`, { id });
      const upd = await get(`SELECT v FROM health_probe WHERE id=@id`, { id });
      await run(`DELETE FROM health_probe WHERE id=@id`, { id });
      const gone = await get(`SELECT v FROM health_probe WHERE id=@id`, { id });
      return { write: !!read, read: read?.v === 'w', update: upd?.v === 'u', delete: !gone };
    });
  }

  const allTablesOk = Object.values(tables).every((t) => t.ok);
  return {
    ok: true,
    status: allTablesOk ? 'up' : 'degraded',
    latencyMs: Date.now() - started,
    // Absent rather than empty when it was not asked for: `migrationsApplied: []`
    // reads as "no migrations have run", which is a different and alarming claim.
    ...(wantsCensus ? { migrationsApplied: migrations.ok ? migrations.value : [], tables } : {}),
    ...(crud ? { crud: crud.ok ? crud.value : { ok: false, error: crud.error } } : {}),
  };
}

function emailHealth() {
  const provider = config.email.smtpUrl ? 'smtp' : config.email.resendApiKey ? 'resend' : 'none';
  return {
    ok: provider !== 'none',
    status: provider === 'none' ? 'not_configured' : 'configured',
    provider,
    from: config.email.fromAddress,
    note: provider === 'none' ? 'Set RESEND_API_KEY (and a verified domain) to deliver emails.' : undefined,
  };
}

function smsHealth() {
  return {
    ok: config.sms.enabled,
    status: config.sms.enabled ? 'configured' : 'not_configured',
    provider: config.sms.enabled ? 'twilio' : 'none',
    note: config.sms.enabled ? undefined : 'Set TWILIO_ACCOUNT_SID / AUTH_TOKEN / FROM for phone OTP.',
  };
}

function storageHealth() {
  // Screenshots/proofs are stored as external URLs today (no blob bucket needed).
  return { ok: true, status: 'external_urls', provider: 'none',
    note: 'Payment screenshots are submitted as links; no blob storage required.' };
}

function queueHealth() {
  const configured = !!config.security.cronSecret;
  return {
    ok: true,
    status: configured ? 'configured' : 'open',
    type: 'vercel-cron',
    schedule: 'hourly /api/cron/maintenance',
    note: configured ? undefined : 'Set CRON_SECRET to lock the maintenance endpoint in production.',
  };
}

export async function healthSummary({ deep = false, tables = false } = {}) {
  const database = await databaseHealth(deep, tables);
  const email = emailHealth();
  const sms = smsHealth();
  const storage = storageHealth();
  const queue = queueHealth();
  return {
    ok: database.ok && (database.status !== 'down'),
    ts: nowIso(),
    env: config.isProd ? 'production' : 'development',
    database, email, sms, storage, queue,
  };
}
