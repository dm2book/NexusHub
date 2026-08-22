/**
 * Dev-only generator for per-pack product covers (amount printed on the art).
 * Run:  node scripts/gen-pack-covers.mjs
 * Writes SVGs to public/products/packs/<category>-<amount>.svg
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'products', 'packs');
fs.mkdirSync(OUT, { recursive: true });
const fmt = (n) => n.toLocaleString('en-US');

// theme: bg gradient, coin gradient, emblem text+color, unit sublabel, footer.
const CATS = {
  robux:    { amounts: [1000,2000,4500,10000,22500], bg:['#10b981','#0d9488'], coin:['#fde68a','#f59e0b'], emblem:'R$', ec:'#7c2d12', unit:'ROBUX', foot:'INSTANT TOP-UP' },
  vbucks:   { amounts: [1000,2800,5000,13500],       bg:['#7c3aed','#2563eb'], coin:['#bae6fd','#38bdf8'], emblem:'V',  ec:'#1e3a8a', unit:'V-BUCKS', foot:'FORTNITE' },
  cod:      { amounts: [2400,5000,9500,21000],        bg:['#ea580c','#b91c1c'], coin:['#fed7aa','#f97316'], emblem:'CP', ec:'#7c2d12', unit:'CP POINTS', foot:'CALL OF DUTY' },
  brawl:    { amounts: [360,950,2000],                bg:['#f59e0b','#ca8a04'], coin:['#fef9c3','#fde047'], emblem:'BS', ec:'#78350f', unit:'GEMS', foot:'BRAWL STARS' },
  apex:     { amounts: [1000,2150,4350,11500],        bg:['#ef4444','#7f1d1d'], coin:['#fecaca','#f87171'], emblem:'AC', ec:'#7f1d1d', unit:'APEX COINS', foot:'APEX LEGENDS' },
  valorant: { amounts: [1000,2050,3650,5350],         bg:['#fb7185','#be123c'], coin:['#fecdd3','#fb7185'], emblem:'VP', ec:'#881337', unit:'VP POINTS', foot:'VALORANT' },
  genshin:  { amounts: [980,1980,3280,6480],          bg:['#22d3ee','#6366f1'], coin:['#cffafe','#22d3ee'], emblem:'GC', ec:'#155e75', unit:'CRYSTALS', foot:'GENSHIN IMPACT' },
  clash:    { amounts: [500,1200,2500,6500],          bg:['#8b5cf6','#2563eb'], coin:['#ddd6fe','#a78bfa'], emblem:'CC', ec:'#4c1d95', unit:'GEMS', foot:'CLASH OF CLANS' },

  /* The rest of the catalogue.
     Eight categories had per-amount covers and the other ten did not, so those
     ten showed ONE picture across every tier — three Clash Royale packs, three
     Steam denominations, all identical but for the price underneath. Measured
     across the catalogue: 11 pictures shared by 30 of 71 products.

     Amounts here are the ones the shop actually sells, taken from the catalogue
     rather than invented, so no cover implies a pack that cannot be bought.

     On trademarks: these covers carry no logos. The emblem is a two-letter
     abbreviation on our own coin, the palette is ours, and the footer names the
     game the currency is FOR — which is what a reseller has to say to describe
     what it is selling, and is not a claim to be that publisher. */
  clashroyale:  { amounts: [500,1200,2500],       bg:['#3b82f6','#1d4ed8'], coin:['#dbeafe','#60a5fa'], emblem:'CR', ec:'#1e3a8a', unit:'GEMS',      foot:'CLASH ROYALE' },
  eafc:         { amounts: [1600,4600,12000],     bg:['#22c55e','#065f46'], coin:['#dcfce7','#4ade80'], emblem:'FC', ec:'#065f46', unit:'FC POINTS', foot:'EA SPORTS FC' },
  freefire:     { amounts: [530,1080,2200],       bg:['#f97316','#b91c1c'], coin:['#ffedd5','#fb923c'], emblem:'FF', ec:'#7c2d12', unit:'DIAMONDS',  foot:'FREE FIRE' },
  league:       { amounts: [1380,3500,8000],      bg:['#0ea5e9','#1e3a8a'], coin:['#fef3c7','#fbbf24'], emblem:'RP', ec:'#1e3a8a', unit:'RP',        foot:'LEAGUE OF LEGENDS' },
  mlbb:         { amounts: [275,565,1155],        bg:['#6366f1','#7e22ce'], coin:['#e0e7ff','#a5b4fc'], emblem:'ML', ec:'#3730a3', unit:'DIAMONDS',  foot:'MOBILE LEGENDS' },
  pubg:         { amounts: [660,1800,3850],       bg:['#eab308','#78350f'], coin:['#fef9c3','#facc15'], emblem:'UC', ec:'#78350f', unit:'UC',        foot:'PUBG MOBILE' },
  minecraft:    { amounts: [1720,3500],           bg:['#65a30d','#3f6212'], coin:['#ecfccb','#a3e635'], emblem:'MC', ec:'#365314', unit:'MINECOINS', foot:'MINECRAFT' },
  pokemongo:    { amounts: [550,1200],            bg:['#facc15','#0ea5e9'], coin:['#fef9c3','#fde047'], emblem:'PC', ec:'#78350f', unit:'POKÉCOINS', foot:'POKÉMON GO' },

  /* Two that are not a quantity. A Shark Card is a named tier and Nitro is a
     length of time, so the big line is the label rather than a formatted number
     — same composition, same dimensions, no special case in the renderer. */
  gta:            { labels: [['great-white','GREAT WHITE'],['whale','WHALE SHARK'],['megalodon','MEGALODON']],
                    bg:['#0ea5e9','#166534'], coin:['#d1fae5','#34d399'], emblem:'$', ec:'#065f46', unit:'SHARK CARD', foot:'GTA ONLINE' },
  /* Steam Wallet is sold in euro denominations rather than a game currency, so
     the big line is the amount with its symbol. Same composition again. */
  steam:          { labels: [['10','€10'],['25','€25'],['50','€50']],
                    bg:['#334155','#0f172a'], coin:['#e2e8f0','#94a3b8'], emblem:'S', ec:'#1e293b', unit:'WALLET CODE', foot:'STEAM' },
  'discord-nitro':{ labels: [['1-month','1 MONTH'],['1-year','1 YEAR']],
                    bg:['#5865F2','#3730a3'], coin:['#e0e7ff','#818cf8'], emblem:'N',  ec:'#312e81', unit:'NITRO',      foot:'DISCORD' },
};

function cover(t, amount) {
  // A number is formatted; a label is printed as written. The size step keeps a
  // long word inside the same box a long number gets, so every cover in the
  // catalogue has one composition.
  const a = typeof amount === 'number' ? fmt(amount) : String(amount);
  const amtSize = a.length <= 5 ? 64 : a.length <= 7 ? 58 : a.length <= 10 ? 40 : 32;
  const emSize = t.emblem.length === 1 ? 56 : t.emblem.length === 2 ? 40 : 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.coin[0]}"/><stop offset="1" stop-color="${t.coin[1]}"/></linearGradient>
  </defs>
  <rect width="480" height="300" fill="url(#bg)"/>
  <g stroke="#fff" stroke-opacity="0.08"><path d="M0 60H480M0 120H480M0 180H480M0 240H480"/><path d="M120 0V300M240 0V300M360 0V300"/></g>
  <circle cx="110" cy="150" r="58" fill="#000" fill-opacity="0.12"/>
  <circle cx="110" cy="144" r="58" fill="url(#c)" stroke="${t.ec}" stroke-width="3"/>
  <text x="110" y="146" font-family="Arial" font-size="${emSize}" font-weight="900" fill="${t.ec}" text-anchor="middle" dominant-baseline="central">${t.emblem}</text>
  <text x="196" y="128" font-family="Arial" font-size="${amtSize}" font-weight="900" fill="#ffffff">${a}</text>
  <text x="198" y="172" font-family="Arial" font-size="24" font-weight="700" fill="#ffffff" fill-opacity="0.85" letter-spacing="3">${t.unit}</text>
  <text x="32" y="270" font-family="Arial" font-size="15" font-weight="700" fill="#ffffff" fill-opacity="0.8" letter-spacing="2">${t.foot}</text>
</svg>`;
}

let n = 0;
for (const [cat, t] of Object.entries(CATS)) {
  for (const amount of t.amounts || []) {
    fs.writeFileSync(path.join(OUT, `${cat}-${amount}.svg`), cover(t, amount));
    n++;
  }
  for (const [slug, label] of t.labels || []) {
    fs.writeFileSync(path.join(OUT, `${cat}-${slug}.svg`), cover(t, label));
    n++;
  }
}
console.log(`Generated ${n} pack covers in public/products/packs/`);
