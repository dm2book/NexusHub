/**
 * Product names in the catalogue's own style, from the canonical model:
 * "1,000 Robux", "Steam Wallet €25", "1,600 FC Points PlayStation EU".
 * The platform is named only for games sold per console; the region only when
 * it is not global.
 */
import { GAMES } from '../market/normalize.js';

const UNIT_LABEL = { robux: 'Robux', 'v-bucks': 'V-Bucks', vp: 'Valorant Points', 'cod-points': 'COD Points', points: 'FC Points',
  coins: 'Apex Coins', uc: 'UC', 'genesis-crystals': 'Genesis Crystals', rp: 'RP', pokecoins: 'PokéCoins', minecoins: 'Minecoins', cash: 'GTA$' };
const PLATFORM_LABEL = { playstation: 'PlayStation', xbox: 'Xbox', pc: 'PC', nintendo: 'Nintendo', ios: 'iOS', android: 'Android' };
export function productTitle(m) {
  const game = GAMES.find((g) => g.key === m.game);
  const n = Number(m.denomination);
  const region = m.region && !['global', 'unknown', 'any'].includes(m.region) ? ` ${m.region.toUpperCase()}` : '';
  const platformSpecific = game && !game.defaultPlatform && PLATFORM_LABEL[m.platform]
    && !new RegExp(PLATFORM_LABEL[m.platform], 'i').test(game.label) ? ` ${PLATFORM_LABEL[m.platform]}` : '';
  if (m.denomUnit === 'EUR') return `${game?.key === 'steam' ? 'Steam Wallet' : game?.label || m.title} €${n}${region}`;
  /* English, like the rest of the catalogue's names ("Discord Nitro — 1 Month"). */
  if (m.denomUnit === 'months') return `${game?.label || m.title} ${n} ${n === 1 ? 'Month' : 'Months'}${platformSpecific}${region}`;
  const unit = UNIT_LABEL[m.denomUnit] || m.denomUnit;
  const named = ['diamonds', 'gems'].includes(m.denomUnit) ? `${n.toLocaleString('en-US')} ${m.denomUnit[0].toUpperCase()}${m.denomUnit.slice(1)} — ${game?.label}`
    : `${n.toLocaleString('en-US')} ${unit}`;
  return `${named}${platformSpecific}${region}`;
}

