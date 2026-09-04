/**
 * What a shipped artboard must contain, and where its picture must point.
 *
 * Five of the 72 card artboards shipped with an EMPTY CIRCLE where the brand
 * mark belongs — apex-1000, ff-1080, robux-1000, val-1000, vbucks-1000, times
 * three boards each. The generator was correct; the files were stale output
 * from a version of markFor() that was not, and nothing re-checked them. They
 * were on the live shop, and the only way anyone was going to notice was by
 * looking at all 216 pictures.
 *
 * So this suite looks at all 216, plus the two places a product picture leaves
 * the site: the share card and the Discord embed. Both were pointing somewhere
 * that could not work — the share card at a 7:6 image while declaring 1200x630,
 * the Discord embed at a site-relative path, which Discord drops.
 *
 * No database and no browser: every property here belongs to a file on disk or
 * to a pure function, so it runs in a second and never gets skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headline } from '../../scripts/art/design.mjs';
import { CATALOG } from '../src/db/demoSeed.js';
import { RASTER_ICONS, markPath } from '../../src/lib/brandMarks.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = path.join(ROOT, 'public', 'products', 'art');
const ICONS = path.join(ROOT, 'public', 'products', 'icons');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const boards = fs.readdirSync(ART).filter((f) => f.endsWith('.svg'));

console.log('— every artboard is the shape of the box it lands in —');
{
  const shapes = boards.map((f) => {
    const s = fs.readFileSync(path.join(ART, f), 'utf8');
    const m = /viewBox="0 0 (\d+) (\d+)"/.exec(s);
    return { f, w: m ? +m[1] : null, h: m ? +m[2] : null };
  });
  const card = shapes.filter((x) => !/-banner\.svg$/.test(x.f));
  const banner = shapes.filter((x) => /-banner\.svg$/.test(x.f));
  ok('there are boards to check at all', shapes.length >= 200, `${shapes.length}`);
  // 7:6 exactly — the card media box is aspect-[7/6], so anything else letterboxes.
  ok('every card board is 700x600', card.every((x) => x.w === 700 && x.h === 600),
    card.filter((x) => x.w !== 700 || x.h !== 600).map((x) => x.f).join(', '));
  ok('every banner board is 1600x900', banner.every((x) => x.w === 1600 && x.h === 900),
    banner.filter((x) => x.w !== 1600 || x.h !== 900).map((x) => x.f).join(', '));
}

console.log('\n— no artboard ships with an empty stage —');
{
  /* The mark is composited as a nested <svg> (vector) or an <image> (the four
     raster trademarks). A board with neither drew the ring and nothing inside
     it, which is what the five blank boards looked like: a product with no
     picture of what it is. */
  const blank = boards.filter((f) => {
    const s = fs.readFileSync(path.join(ART, f), 'utf8');
    return !/<svg\b[^>]*viewBox/.test(s.replace(/^[\s\S]*?<svg[^>]*>/, '')) && !/<image\b/.test(s);
  });
  ok('every board carries a brand mark', blank.length === 0, `${blank.length} blank: ${blank.slice(0, 8).join(', ')}`);
}

console.log('\n— the stage means the same thing for every mark —');
{
  /* Marks are fitted by their INK, not their canvas: the SVGs are drawn on a
     512 square with padding and the rasters are cropped tight, so fitting by
     canvas painted some logos half again as large as others in the same grid.
     The measurement lives in _ink.json; a mark missing from it silently falls
     back to canvas fitting, which is the bug returning quietly. */
  const ink = JSON.parse(fs.readFileSync(path.join(ICONS, '_ink.json'), 'utf8'));
  const referenced = [...new Set(fs.readdirSync(ICONS).filter((f) => /\.(svg|webp)$/.test(f)))];
  const missing = referenced.filter((f) => !ink[f]);
  ok('every mark on disk has a measured ink box', missing.length === 0, missing.join(', '));
  const spans = Object.values(ink).map((v) => v.spanPct);
  ok('the measurements look like measurements', spans.length > 50 && spans.every((v) => v > 10 && v <= 100),
    `${spans.length} entries`);
}

console.log('\n— every product gets a headline, and the raster list is honest —');
{
  const noHeadline = CATALOG.filter((p) => p.active !== false && !headline(p.name, p.description));
  /* A tile with no number is a tile a shopper cannot price at a glance. Three
     GTA cards shipped identical for exactly this reason; their amounts were in
     the shop's own description field all along. */
  ok('no catalogue product renders a numberless tile', noHeadline.length === 0,
    noHeadline.map((p) => p.sku).join(', '));
  ok('and the raster marks all resolve to a file that exists',
    [...RASTER_ICONS].every((c) => fs.existsSync(path.join(ROOT, 'public', markPath(c).slice(1)))),
    [...RASTER_ICONS].join(', '));
}

console.log('\n— the two places a picture leaves the site —');
{
  const seo = fs.readFileSync(path.join(ROOT, 'server/src/routes/seo.js'), 'utf8');
  /* A share card is cropped to roughly 1.91:1. Serving the 7:6 card board while
     declaring 1200x630 asks every platform to letterbox it; the 16:9 board was
     authored for this and was referenced by nothing but its own test. */
  ok('the share card uses the banner board', /-banner\.svg/.test(seo), 'seo.js');
  ok('and declares the size it actually serves',
    /imageSize\.w/.test(seo) && /w: 1600, h: 900/.test(seo), 'seo.js og:image:width');
  ok('the hard-coded 1200x630 against a 700x600 image is gone',
    !/og:image:width" content="1200"/.test(seo));

  const dis = fs.readFileSync(path.join(ROOT, 'server/src/services/discordService.js'), 'utf8');
  /* Discord drops a thumbnail whose url is not absolute, so a relative path
     announced the artwork to nobody. */
  ok('the Discord thumbnail is absolutised', /config\.appUrl\}\$\{data\.image\}|config\.appUrl\}\$\{/.test(dis)
    && /embed\.thumbnail = \{ url: thumb \}/.test(dis), 'discordService.js');
  ok('and a data URI is skipped rather than pasted into an embed', /\^data:/.test(dis));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
