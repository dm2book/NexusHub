/**
 * What gets a message deleted, and why.
 *
 * This server is full of 13-17 year olds who are actively hunted by people
 * selling "cheap robux". The generic invite/nitro patterns are the easy half.
 * The two that actually cost someone money here are:
 *
 *   1. a lookalike store domain — forgemarket.shop, forge-market.nl — posted by
 *      someone pretending to be us. This is the highest-value scam against a
 *      shop's own Discord, and nothing was looking for it.
 *   2. "dm me for cheap robux" — poaching a buyer into a private deal with no
 *      protection, which is exactly what the storefront's whole trust story
 *      exists to avoid.
 *
 * Pure module, no discord.js: the guard is only worth having if it is tested,
 * and bot.js cannot be imported without logging in to Discord.
 */

/** Invite links and the usual nitro/airdrop bait. */
export const SCAM_PHRASE =
  /(discord\.(gg|com\/invite)\/|free\s*nitro|steamcommunity\.com\/(gift|trade)|t\.me\/|claim\s+your\s+(reward|prize|nitro)|airdrop|nitro\s+giveaway\s+http)/i;

const GOODS = String.raw`robux|v-?bucks|vbucks|valorant|vp|nitro|gift\s*cards?|top.?ups?|points`;
/** "dm me for cheap robux" and every ordering of it. */
export const SOLICIT = new RegExp(
  String.raw`\b(dm|pm|hmu|add)\s+(me|my|for)\b[\s\S]{0,80}\b(${GOODS}|cheap|cheaper|price|selling)\b`, 'i');
export const SOLICIT_REVERSE = new RegExp(
  String.raw`\b(selling|sell|cheap|cheaper)\b[\s\S]{0,80}\b(${GOODS})\b[\s\S]{0,80}\b(dm|pm|hmu|add)\s+(me|my|for)\b`, 'i');

/**
 * A link that borrows our name without being us.
 *
 * Compares every host in the message against the real one. Subdomains of the
 * real host are fine; anything else carrying the brand word is not.
 */
export function lookalikeHost(content, storeHost = 'forgemarket.nl') {
  const real = String(storeHost).replace(/^www\./, '').toLowerCase();
  const brand = real.split('.')[0].replace(/[^a-z0-9]/g, '');
  if (!brand) return null;
  for (const m of String(content).matchAll(/https?:\/\/([^\s/$.?#][^\s/]*)/gi)) {
    const host = m[1].replace(/^www\./, '').toLowerCase().split(':')[0];
    if (host === real || host.endsWith(`.${real}`)) continue;              // genuinely us
    const bare = host.replace(/[^a-z0-9]/g, '');
    // Exact brand word anywhere in the host, or a near-miss of it (one edit).
    if (bare.includes(brand) || nearMiss(bare, brand)) return host;
  }
  return null;
}

/** True when `bare` contains a one-edit variation of `brand` (forgemarkt, forgemarekt). */
function nearMiss(bare, brand) {
  // A typosquat differs from the brand by at most one insert, delete or swap, so
  // only windows within one character of the brand's length can match.
  for (const len of [brand.length - 1, brand.length, brand.length + 1]) {
    if (len < 3 || len > bare.length) continue;
    for (let i = 0; i + len <= bare.length; i++) {
      if (editDistance(bare.slice(i, i + len), brand) <= 1) return true;
    }
  }
  return false;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * Why this message should be removed, or null to leave it alone.
 * Ordered by what each one costs the victim.
 */
export function scamReason(content, { storeHost = 'forgemarket.nl', mentionCount = 0, mentionsEveryone = false } = {}) {
  const text = String(content || '');
  const fake = lookalikeHost(text, storeHost);
  if (fake) return { kind: 'lookalike', detail: fake, label: `lookalike domain \`${fake}\`` };
  if (SOLICIT.test(text) || SOLICIT_REVERSE.test(text)) {
    return { kind: 'solicit', label: 'selling top-ups by DM' };
  }
  if (mentionsEveryone || mentionCount >= 5) return { kind: 'mention', label: 'mass mention' };
  if (SCAM_PHRASE.test(text)) return { kind: 'phrase', label: 'invite link / scam phrase' };
  return null;
}
