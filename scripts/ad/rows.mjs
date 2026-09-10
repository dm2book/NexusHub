#!/usr/bin/env node
/**
 * Where an overlay actually sits in the frame.
 *
 * Two overlays collided in the product-first cut and neither was visible from
 * the CSS: the product card ran y 233 → 1400 while the hook caption sat at
 * 1160, so the card printed straight across the line. The arithmetic said they
 * cleared by nineteen pixels. They did not, because a name had wrapped to two
 * lines and a rise animation moved the card down another forty.
 *
 * So: measure, do not reason. One byte per row of the finished 1080×1920
 * overlay, saying how much of that row is opaque, and the first and last rows
 * that carry anything.
 *
 *   node scripts/ad/rows.mjs out/steam-10/productcard.png out/steam-10/captions/cap-00.png
 *   productcard.png    y  212 → 1076
 *   cap-00.png         y 1160 → 1340
 */
import { execFileSync } from 'node:child_process';
const FF = '/tmp/claude-0/node_modules/ffmpeg-static/ffmpeg';
for (const f of process.argv.slice(2)) {
  const buf = execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', f,
    '-vf', 'format=rgba,alphaextract,scale=1:1920:flags=area', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
  let top = -1; let bottom = -1;
  for (let y = 0; y < buf.length; y++) if (buf[y] > 4) { if (top < 0) top = y; bottom = y; }
  console.log(`${f.split('/').pop().padEnd(18)} y ${String(top).padStart(4)} → ${String(bottom).padStart(4)}`);
}
