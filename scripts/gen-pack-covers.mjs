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
};

function cover(t, amount) {
  const a = fmt(amount);
  const amtSize = a.length <= 5 ? 64 : a.length === 6 ? 58 : 50;
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
  for (const amount of t.amounts) {
    fs.writeFileSync(path.join(OUT, `${cat}-${amount}.svg`), cover(t, amount));
    n++;
  }
}
console.log(`Generated ${n} pack covers in public/products/packs/`);
