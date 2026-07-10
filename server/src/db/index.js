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
function getPool() {
  if (_pool) return _pool;
  const connectionString = config.db.url;
  if (!connectionString) {
    throw new ApiError(503, 'Database not configured. On Vercel: connect a Postgres ' +
      'database in the Storage tab and redeploy (sets DATABASE_URL).');
  }
  _pool = new pg.Pool({
    connectionString,
    // Vercel/Neon poolers terminate idle connections; keep the pool small.
    max: Number(process.env.PG_POOL_MAX || 5),
    ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    // Never let a stuck connection or query burn the whole 30s serverless
    // budget (→ a 504 "An error occurred", non-JSON). Fail fast with a clean
    // error so the request can still respond normally.
    connectionTimeoutMillis: 12_000,
    statement_timeout: 25_000,
    query_timeout: 25_000,
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
