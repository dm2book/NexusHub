/**
 * Data-access layer — PostgreSQL (serverless-friendly).
 *
 * The rest of the app talks to the database exclusively through this module.
 * To keep our existing `@name` parameterised SQL intact, queries are translated
 * to Postgres positional params ($1,$2,…) on the fly. Transactions use
 * AsyncLocalStorage so nested run/get/all calls inside `tx(async () => …)`
 * automatically run on the transaction's client.
 *
 * Works locally and on Vercel: pass a pooled connection string via DATABASE_URL
 * (or POSTGRES_URL, which Vercel Postgres sets automatically).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

// Return BIGINT (int8) and NUMERIC as JS numbers — our values (cents, counts)
// are well within Number's safe range, and this keeps arithmetic simple.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

// Lazily create the pool on first use. This way a missing/incorrect connection
// string surfaces as a clean JSON error from a request (and lets DB-free routes
// like /api/config keep working) instead of crashing the whole function at
// cold-start with an opaque "A server error has occurred".
let _pool = null;

/**
 * The connection string, with its TLS mode stated rather than implied.
 *
 * Neon's URLs say `sslmode=require`. pg 8 reads that as verify-full — the
 * certificate IS checked — and warns that pg 9 will read it the libpq way,
 * where `require` encrypts without checking who is on the other end. Seen in
 * the production logs 390 times a week. Writing `verify-full` keeps exactly
 * today's behaviour, silences the warning, and means the library upgrade
 * cannot quietly weaken the connection. A URL that already chose
 * (`verify-full`, `disable`, or libpq compatibility) is left alone.
 */
export function pgConnectionString(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    if (u.searchParams.get('uselibpqcompat') === 'true') return url;
    if (['prefer', 'require', 'verify-ca'].includes(mode)) {
      u.searchParams.set('sslmode', 'verify-full');
      return u.toString();
    }
    return url;
  } catch { return url; }
}

function getPool() {
  if (_pool) return _pool;
  const connectionString = config.db.url;
  if (!connectionString) {
    throw new ApiError(503, 'Database not configured. On Vercel: connect a Postgres ' +
      'database in the Storage tab and redeploy (sets DATABASE_URL).');
  }
  _pool = new pg.Pool({
    connectionString: pgConnectionString(connectionString),
    // Vercel/Neon poolers terminate idle connections; keep the pool small.
    max: Number(process.env.PG_POOL_MAX || 5),
    /* For a URL that names no sslmode. This used to skip the certificate check
       (rejectUnauthorized: false) — encrypted, but to whoever answered. The
       hosted databases this runs on present publicly trusted certificates, so
       checking costs nothing; DATABASE_SSL_INSECURE=true is the way back for a
       self-signed one, and it has to be asked for. */
    ssl: config.db.ssl ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== 'true' } : undefined,
    // Never let a stuck connection or query burn the whole 30s serverless
    // budget (→ a 504 "An error occurred", non-JSON). Fail fast with a clean
    // error so the request can still respond normally.
    connectionTimeoutMillis: 12_000,
    statement_timeout: 25_000,
    query_timeout: 25_000,
    // Reuse the socket between invocations of a warm instance. pg closes idle
    // clients after 10s by default, and on a quiet shop that means almost every
    // request pays a fresh TCP + TLS + auth handshake to another region — the
    // most expensive thing a request can do before it does any work at all.
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 60_000),
    // A frozen instance's socket looks alive to us and dead to the network in
    // between. Keepalives make the OS notice rather than the next query.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  /* An idle connection dying must not take the shop with it.

     `pg.Pool` is an EventEmitter, and it emits 'error' when a client sitting
     idle in the pool is dropped — which is exactly what Neon's and Vercel's
     poolers do to connections they reclaim, and what happens to the socket of
     an instance that has been frozen. With no listener, Node's default for an
     unhandled 'error' event is to throw, so the WHOLE function process dies and
     the next visitor gets 500 FUNCTION_INVOCATION_FAILED.

     Measured, not reasoned about: terminating one idle backend from another
     session killed the process outright. The pool recovers by itself — it
     discards the dead client and opens a new one on the next query — so the
     only thing missing was somebody listening. */
  _pool.on('error', (err) => {
    console.error(`[db] idle connection dropped (${err.message}) — the pool will reopen one`);
  });

  return _pool;
}

// Proxy so existing `pool.connect()` / `pool.query()` calls work, but the real
// pool is only constructed on first access.
export const pool = new Proxy({}, {
  get(_t, prop) {
    const p = getPool();
    const value = p[prop];
    return typeof value === 'function' ? value.bind(p) : value;
  },
});

const txStore = new AsyncLocalStorage();

/**
 * Convert `@name` placeholders to `$n`, returning [sql, valuesArray].
 * Only names present as keys in `params` are substituted, so stray `@` inside
 * string literals (e.g. an email like a@b.com) are left untouched.
 */
function translate(sql, params = {}) {
  const order = [];
  const seen = new Map();
  const out = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    if (!seen.has(name)) { seen.set(name, seen.size + 1); order.push(name); }
    return `$${seen.get(name)}`;
  });
  const values = order.map((n) => (params[n] === undefined ? null : params[n]));
  return [out, values];
}

function executor() {
  // Inside a transaction, use the bound client; otherwise the pool.
  return txStore.getStore() || pool;
}

async function query(sql, params) {
  const [text, values] = translate(sql, params);
  return executor().query(text, values);
}

/** INSERT/UPDATE/DELETE/DDL. Returns { changes }. */
export async function run(sql, params = {}) {
  const res = await query(sql, params);
  return { changes: res.rowCount };
}
/** Fetch a single row or undefined. */
export async function get(sql, params = {}) {
  const res = await query(sql, params);
  return res.rows[0];
}
/** Fetch all matching rows. */
export async function all(sql, params = {}) {
  const res = await query(sql, params);
  return res.rows;
}

/**
 * Run `fn` inside a transaction. Acquires a dedicated client and binds it for
 * the duration via AsyncLocalStorage so all run/get/all calls inside join it.
 */
export async function tx(fn) {
  // Reuse an outer transaction if already inside one.
  if (txStore.getStore()) return fn();
  const client = await pool.connect();
  try {
    return await txStore.run(client, async () => {
      await client.query('BEGIN');
      try {
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  } finally {
    client.release();
  }
}

/** Execute a raw multi-statement SQL string (used by migrations). */
export async function exec(sql) {
  return executor().query(sql);
}

export function nowIso() {
  return new Date().toISOString();
}
