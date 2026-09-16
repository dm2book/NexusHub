#!/usr/bin/env node
/**
 * Draw every Discord banner and the link-preview card.
 *
 *   node scripts/art/social-generate.mjs           write the files
 *   node scripts/art/social-generate.mjs --check    report only, write nothing
 *
 * Idempotent: the same input produces the same bytes, so this can be re-run
 * without accumulating anything. It prints each file's short sha, which is what
 * scripts/ad/static-creatives.mjs pins its copy record to — so a redrawn banner
 * cannot keep an old, wrong description of what it says.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { SOCIAL, OG, bannerHtml, ogHtml } from './social.mjs';

const ROOT = process.cwd();
const check = process.argv.includes('--check');
const BROWSER = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const shortSha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

const browser = await chromium.launch({ executablePath: BROWSER });
const jobs = [
  ...SOCIAL.map((s) => ({ spec: s, html: bannerHtml(s), w: 2200, h: 720 })),
  { spec: OG, html: ogHtml(OG), w: 1200, h: 630 },
];

const report = [];
for (const { spec, html, w, h } of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  /* The faces are inlined as data URIs and declared `font-display:block`, but
     the screenshot can still land between layout and first paint with the
     fallback metrics — which is a headline at the wrong width, silently. */
  await page.evaluate(() => document.fonts.ready);
  /* JPEG, not PNG. These are full-bleed gradient artworks, which is the one
     thing PNG is worst at: Chromium dithers a smooth ramp and the noise
     defeats the compressor. Measured on the welcome banner — PNG 888KB,
     JPEG q92 118KB, and side by side at Discord's display size there is no
     difference to see. The share card matters most: og.png came out at 436KB
     against a 150KB budget, and the alternative that fit was a banded
     background that looked like a rendering fault. */
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  await page.close();

  const out = path.join(ROOT, spec.file);
  const before = fs.existsSync(out) ? shortSha(fs.readFileSync(out)) : '(none)';
  const after = shortSha(buf);
  if (!check) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
  }
  report.push({ file: spec.file, size: `${w}x${h}`, kb: Math.round(buf.length / 1024), before, after });
}
await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('file', 42)} ${pad('size', 10)} ${pad('kb', 6)} ${pad('was', 18)} now`);
for (const r of report) {
  console.log(`${pad(r.file, 42)} ${pad(r.size, 10)} ${pad(r.kb, 6)} ${pad(r.before, 18)} ${r.after}`);
}
console.log(`\n${check ? 'checked' : 'wrote'} ${report.length} creatives`);
console.log('If any sha changed, update it in BOTH:');
console.log('  · scripts/ad/static-creatives.mjs  (`sha`)');
console.log('  · discord/src/config.js            (BANNER_VERSION — the ?v= Discord caches on)');
