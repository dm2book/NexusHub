/**
 * Dev-only generator for per-pack product covers (amount printed on the art).
 * Run:  node scripts/gen-pack-covers.mjs
 * Outputs SVGs into public/products/packs/.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'products', 'packs');
fs.mkdirSync(OUT, { recursive: true });

const fmt = (n) => n.toLocaleString('en-US');

function robux(amount) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#0d9488"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
  </defs>
  <rect width="480" height="300" fill="url(#bg)"/>
  <g stroke="#fff" stroke-opacity="0.08"><path d="M0 60H480M0 120H480M0 180H480M0 240H480"/><path d="M120 0V300M240 0V300M360 0V300"/></g>
  <circle cx="110" cy="150" r="58" fill="#000" fill-opacity="0.12"/>
  <circle cx="110" cy="144" r="58" fill="url(#c)" stroke="#b45309" stroke-width="3"/>
  <text x="110" y="146" font-family="Arial" font-size="44" font-weight="900" fill="#7c2d12" text-anchor="middle" dominant-baseline="central">R$</text>
  <text x="200" y="128" font-family="Arial" font-size="64" font-weight="900" fill="#ffffff">${fmt(amount)}</text>
  <text x="202" y="172" font-family="Arial" font-size="26" font-weight="700" fill="#d1fae5" letter-spacing="4">ROBUX</text>
  <text x="32" y="270" font-family="Arial" font-size="16" font-weight="700" fill="#ffffff" fill-opacity="0.8" letter-spacing="2">INSTANT TOP-UP</text>
</svg>`;
}

function vbucks(amount) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300" width="480" height="300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
  </defs>
  <rect width="480" height="300" fill="url(#bg)"/>
  <g fill="#fff" fill-opacity="0.08"><path d="M60 40 l8 20 20 8 -20 8 -8 20 -8 -20 -20 -8 20 -8 z"/><path d="M430 230 l9 22 22 9 -22 9 -9 22 -9 -22 -22 -9 22 -9 z"/></g>
  <circle cx="110" cy="150" r="58" fill="#000" fill-opacity="0.12"/>
  <circle cx="110" cy="144" r="58" fill="url(#c)" stroke="#1d4ed8" stroke-width="3"/>
  <text x="110" y="146" font-family="Arial" font-size="56" font-weight="900" fill="#1e3a8a" text-anchor="middle" dominant-baseline="central">V</text>
  <text x="200" y="128" font-family="Arial" font-size="60" font-weight="900" fill="#ffffff">${fmt(amount)}</text>
  <text x="202" y="172" font-family="Arial" font-size="24" font-weight="700" fill="#dbeafe" letter-spacing="3">V-BUCKS</text>
  <text x="32" y="270" font-family="Arial" font-size="16" font-weight="700" fill="#ffffff" fill-opacity="0.8" letter-spacing="2">FORTNITE</text>
</svg>`;
}

const packs = [
  ...[1000, 2000, 4500, 10000, 22500].map((a) => [`robux-${a}`, robux(a)]),
  ...[1000, 2800, 5000, 13500].map((a) => [`vbucks-${a}`, vbucks(a)]),
];

for (const [name, svg] of packs) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
}
console.log(`Generated ${packs.length} pack covers in public/products/packs/`);
