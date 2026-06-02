/**
 * Data-access layer.
 *
 * The rest of the app talks to the database exclusively through this module so
 * the underlying engine (SQLite today, Postgres tomorrow) stays swappable. We
 * expose a tiny query surface plus a transaction helper.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';

const dbFile = config.db.file;
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Run a statement that returns no rows (INSERT/UPDATE/DELETE/DDL). */
export const run = (sql, params = {}) => db.prepare(sql).run(params);
/** Fetch a single row or undefined. */
export const get = (sql, params = {}) => db.prepare(sql).get(params);
/** Fetch all matching rows. */
export const all = (sql, params = {}) => db.prepare(sql).all(params);

/**
 * Execute `fn` inside a transaction. Nested calls reuse the outer transaction
 * because better-sqlite3 transactions are synchronous and savepoint-free.
 */
export const tx = (fn) => db.transaction(fn);

export function nowIso() {
  return new Date().toISOString();
}
