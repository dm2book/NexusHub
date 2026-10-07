/**
 * Real brand logos on the product cards.
 *
 * From Simple Icons (CC0, pinned devDependency), generated into
 * server/src/generated/brandLogos.js by scripts/art/gen-brand-logos.mjs:
 *   - the generated module is current (a logo added to the map without
 *     regenerating fails here, not in production);
 *   - every logo records its source and licence;
 *   - games and stores show the mark beside their name, services whose mark is
 *     the product (Spotify) get it as an app icon;
 *   - wordmarks (Activision, Supercell, miHoYo) are not used — unreadable at
 *     badge size;
 *   - brands that are not in Simple Icons are not drawn from anywhere else.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

console.log('— The generated logos —');
{
  let current = true;
  try { execFileSync(process.execPath, ['scripts/art/gen-brand-logos.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' }); } catch { current = false; }
  ok('server/src/generated/brandLogos.js matches the map and the pinned simple-icons', current);
  const { LOGOS } = await import('../src/generated/brandLogos.js');
  const all = Object.values(LOGOS);
  ok('at least 20 brands', all.length >= 20, `${all.length}`);
  ok('every logo says where it is from and under which licence', all.every((l) => /^simple-icons\//.test(l.source) && l.license === 'CC0-1.0'));
  ok('every logo is a path in a 24×24 box with the brand colour', all.every((l) => /^[Mm]/.test(l.path) && /^#[0-9A-F]{6}$/i.test(l.hex)));
  ok('no wordmark that is unreadable at badge size', !all.some((l) => /activision|supercell|mihoyo/.test(l.source)));
  ok('the brands the shop sells most are there', ['robux', 'v-bucks', 'playstation', 'steam', 'valorant', 'league', 'spotify', 'discord-nitro', 'netflix', 'googleplay', 'itunes', 'eafc', 'gta', 'pubg'].every((k) => LOGOS[k]));
}

console.log('\n— On the cards —');
{
  const { cardSvg } = await import('../../scripts/art/render.mjs');
  const { LOGOS } = await import('../src/generated/brandLogos.js');
  const robux = cardSvg({ name: '1,000 Robux', category: 'robux' }, { brand: null });
  ok('a game card carries its real mark beside the name', robux.includes(LOGOS.robux.path) && /x="74" y="52"[^>]*>ROBLOX/.test(robux));
  const spotify = cardSvg({ name: 'Spotify Premium — 3 Months', category: 'spotify' }, { brand: 'spotify' });
  ok('a service card has its mark as an app icon', spotify.includes(LOGOS.spotify.path) && spotify.includes('id="apptile"'));
  const owner = cardSvg({ name: 'Spotify Premium — 3 Months', category: 'spotify' }, { brand: 'spotify', logo: 'data:image/png;base64,iVBORw0KGgo=' });
  ok('…unless the owner gave a logo: theirs wins', !owner.includes('id="apptile"'));
  const brawl = cardSvg({ name: '360 Gems — Brawl Stars', category: 'brawl' }, {});
  ok('a brand without a usable mark keeps its name and card art, nothing invented', !/<svg x="34" y="30"/.test(brawl) && /x="34" y="52"[^>]*>BRAWL STARS/.test(brawl));
  const xbox = cardSvg({ name: 'Xbox €20 NL', category: 'giftcard' }, { brand: 'xbox' });
  ok('Xbox (not in Simple Icons) is not drawn from anywhere else', !/<svg x="34" y="30"/.test(xbox));
}

console.log(`\n${fail ? '❌' : '✅'} brand-logos: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
