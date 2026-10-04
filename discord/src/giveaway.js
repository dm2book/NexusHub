/**
 * The giveaway draw, as a pure function.
 *
 * Every entrant gets exactly one equal chance. The draw used to add extra
 * tickets for Forge Coin / Forge-Shop "boosts" — which made it a game of
 * chance with paid entries. In the Netherlands that is a promotional game
 * that must not tie better odds to spending, so the weighting is gone: the
 * pool is the set of people who pressed Enter, nothing more.
 *
 * Kept free of discord.js so the rules below are tested rather than trusted:
 *   · nobody can win twice in one draw;
 *   · a reroll never hands the prize back to someone who already won it;
 *   · the published fingerprint lets anyone holding the entrant list check
 *     that the draw used the list it claims to have used.
 */
import { createHash, randomInt } from 'node:crypto';

/**
 * Draw `count` distinct winners from `entrants`, skipping `exclude`.
 * crypto.randomInt rather than Math.random: the terms say the draw is random,
 * and a CSPRNG is the honest way to make that true.
 */
export function drawWinners(entrants, count = 1, { exclude = [], rand = randomInt } = {}) {
  const skip = new Set(exclude.map(String));
  const pool = [...new Set((entrants || []).map(String))].filter((id) => !skip.has(id));
  const picks = [];
  while (picks.length < Math.max(1, count) && pool.length) {
    picks.push(pool.splice(rand(pool.length), 1)[0]);
  }
  return picks;
}

/**
 * SHA-256 over the sorted entrant ids, newline-separated.
 * Sorted so the fingerprint depends on WHO entered, not the order they did.
 */
export function entrantsFingerprint(entrants) {
  const ids = [...new Set((entrants || []).map(String))].sort();
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}
