/**
 * Background upkeep once per deploy, not once per cold start.
 *
 * The upkeep after boot (email template upgrades, starter content, catalogue
 * image backfill) is about a hundred queries. It only has anything to do when
 * the CODE changed — and it was running on every cold start of every instance.
 * Read from the production logs: "[boot] background upkeep: Query read
 * timeout", 44 times in a week, each one a cold start spending its first
 * seconds hammering the database while a visitor waited on the same pool.
 *
 * So the first instance of a deploy claims it in `kv` and the rest skip it.
 * The claim is one statement — two instances starting together cannot both
 * win — and a run that fails gives the claim back, so the next cold start
 * tries again rather than the deploy never finishing its upkeep.
 *
 * Off Vercel there is no deploy id, and upkeep runs on every boot as before.
 */
import { get, run, nowIso } from '../db/index.js';

const KEY = 'boot_upkeep_deploy';

/** The deploy this instance belongs to, or null when the platform does not say. */
export const deployKey = (env = process.env) => env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA || null;

/** True when this instance should run the upkeep for `key`. */
export async function claimUpkeep(key) {
  if (!key) return true;
  const v = JSON.stringify(key);
  const row = await get(
    `INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at)
     ON CONFLICT (key) DO UPDATE SET value = @v, updated_at = @at
       WHERE kv.value <> @v
     RETURNING key`, { k: KEY, v, at: nowIso() });
  return !!row;
}

/** Give the claim back after a failed run, so another cold start retries. */
export async function releaseUpkeep(key) {
  if (!key) return;
  await run(`DELETE FROM kv WHERE key = @k AND value = @v`, { k: KEY, v: JSON.stringify(key) });
}
