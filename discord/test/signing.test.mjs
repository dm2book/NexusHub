/**
 * The bot's v2 request signature must be exactly what the store verifies.
 * Runs these exact functions against the store's own (server/src/utils/crypto.js).
 * No Postgres, no Discord token.
 */
import { canonicalJson, signRequestV2 } from '../src/signing.js';
import { canonicalJson as storeCanonical, v2SignedString, hmacSha256 } from '../../server/src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— v2 signatures: bot and store agree —');
const bodies = [
  {},
  { key: 'xp', value: { b: 1, a: [3, { z: true, y: null }] } },
  { uid: '123456789012345678' },
  { author: 'Ä Q', stars: 5, body: 'Snel geleverd 👍 "quotes" \\ backslash', externalId: 'msg_1', discordUid: '42' },
  { guildId: '1', takenAt: '2026-10-09T12:00:00.000Z', snapshot: { roles: [{ id: 'r', name: 'VIP', perms: '8' }], channels: [] } },
  { ids: ['dox_b', 'dox_a'], n: 1.5, big: 12345678901234, neg: -0.25, empty: '' },
];
for (const b of bodies) {
  const raw = JSON.stringify(b);
  const parsed = JSON.parse(raw);
  ok(`canonical JSON matches for ${raw.slice(0, 40)}…`, canonicalJson(parsed) === storeCanonical(parsed),
    `${canonicalJson(parsed)} ≠ ${storeCanonical(parsed)}`);
  const ts = '1791590000000';
  const header = signRequestV2('s3cr3t', ts, 'POST', '/api/discord/state/set', raw);
  const expected = `v2=${hmacSha256('s3cr3t', v2SignedString({ ts, method: 'POST', path: '/api/discord/state/set', body: parsed }))}`;
  ok('…and the signature is the one the store computes', header === expected);
}
ok('key order does not matter', canonicalJson({ a: 1, b: 2 }) === canonicalJson({ b: 2, a: 1 }));
const ts = '1791590000000';
const sig = signRequestV2('s3cr3t', ts, 'POST', '/api/discord/balance', JSON.stringify({ uid: '1' }));
ok('a different body signs differently', sig !== signRequestV2('s3cr3t', ts, 'POST', '/api/discord/balance', JSON.stringify({ uid: '2' })));
ok('a different path signs differently', sig !== signRequestV2('s3cr3t', ts, 'POST', '/api/discord/referral', JSON.stringify({ uid: '1' })));
ok('a different secret signs differently', sig !== signRequestV2('other', ts, 'POST', '/api/discord/balance', JSON.stringify({ uid: '1' })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
