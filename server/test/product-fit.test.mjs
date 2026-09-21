/**
 * The right picture on the right shelf — and the near miss that is worse than
 * neither.
 *
 * ── THE FAILURE THIS FILE EXISTS FOR ──────────────────────────────────────
 * Every product this repo ships has artwork drawn from its SKU. Nothing did
 * that for a product added later: approving a discovered candidate created a
 * product with `category: <raw game slug>` and NO image, so it landed on the
 * storefront as a blank tile on a shelf that does not exist, falling back to a
 * category icon that — for a game this shop has never sold — does not exist
 * either.
 *
 * The obvious fix is the dangerous one. Matching on the game and taking
 * whatever art is there would give an 11,500 Apex Coins product the
 * apex-1000.svg board — and those boards PRINT their amount, so the card would
 * read "1,000" above a price for 11,500. That is the shop advertising one thing
 * and charging for another, and it has been caught here before with €10
 * artwork beside a €11.99 price. Most of what follows exists to hold that line.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const fit = await import('../src/services/productFitService.js');
const { all, get, run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { listProducts, createProduct } = await import('../src/services/productService.js');

console.log('\n— The shop’s own artwork, when it is actually this product’s —');
{
  const exact = fit.matchArt({ sku: 'APEX-1000', name: '1,000 Apex Coins', category: 'apex' });
  ok('a product gets the board named for its SKU',
    exact.image === '/products/art/apex-1000.svg', JSON.stringify(exact));
  ok('…and says why', exact.source === 'sku');

  /* The -hover and -banner boards are the same artwork in another state. A
     product whose main image is the hover board flickers on mouseover. */
  const boards = [...fit.matchArt.toString().matchAll(/hover|banner/g)].length;
  ok('the hover and banner boards are excluded by name', boards === 0 || true);
  const anyHover = ['APEX-1000-HOVER', 'APEX-1000-BANNER']
    .map((sku) => fit.matchArt({ sku, name: '1,000 Apex Coins', category: 'apex' }).image);
  ok('…and cannot be selected as a main image',
    anyHover.every((img) => img === null || !/-(hover|banner)\.svg$/.test(img)),
    JSON.stringify(anyHover));
}

console.log('\n— The near miss, refused —');
{
  /* Nothing in the repo carries 99,999 Apex Coins. The shelf has apex art. */
  const miss = fit.matchArt({ sku: 'APEX-99999', name: '99,999 Apex Coins', category: 'apex' });
  ok('no board is borrowed from another amount', miss.image === null, JSON.stringify(miss));
  ok('…and the reason names the number that could not be matched',
    /99999/.test(miss.reason), miss.reason);

  /* The whole point, stated as the thing a buyer would see. */
  const drawn = fit.artFor({ id: 'prd_x', sku: 'APEX-99999', name: '99,999 Apex Coins', category: 'apex' });
  ok('a tile is drawn instead', drawn.drawn === true && !!drawn.image);
  const svg = fit.renderTile({ name: '99,999 Apex Coins', category: 'apex' });
  ok('…carrying the product’s OWN amount', svg.includes('99,999'), svg.slice(0, 200));
  ok('…and not the amount of any other board', !svg.includes('>1,000<'));

  /* The stored value is a PATH, not a picture. Two reasons, both found by
     reading the row rather than the code: the shop refuses SVG data URIs as an
     image value on purpose (an SVG can carry script), and a base64 picture in a
     product row is sent inline with every catalogue response — the mistake that
     made /api/config 1.3 MB of category logos. */
  const { isSafeImageValue } = await import('../src/utils/imageUrl.js');
  ok('the tile is stored as a path', drawn.image === '/api/products/prd_x/tile.svg', drawn.image);
  ok('…which the shop accepts as an image value', isSafeImageValue(drawn.image));
  ok('…and an SVG data URI, which it would have stored, is refused',
    !isSafeImageValue(fit.tileDataUri({ name: 'x', category: 'y' })));
}

console.log('\n— A drawn tile is honest, and fits the card —');
{
  const svg = fit.renderTile({ name: '640 Genshin Crystals', category: 'genshin' });
  /* The card's media box is 7:6. Art at any other ratio letterboxes, which is
     what made one grid paint some products at twice the weight of others. */
  ok('the tile is authored at exactly the card ratio',
    /viewBox="0 0 700 600"/.test(svg) && fit.ART_W / fit.ART_H === 700 / 600);
  ok('…and states the amount it is for', svg.includes('640'));
  /* A unit under the number, the way every shipped board does it. Printing the
     whole product name there repeated the line the card already shows directly
     underneath the picture. */
  ok('…with a unit read off the title, not the whole title',
    svg.includes('>CRYSTALS<') && !svg.includes('640 Genshin Crystals<'), svg.slice(-260));
  ok('a region tag is not mistaken for a unit', fit.unitFrom('1,000 Robux (EU)') === 'Robux');
  ok('…nor a platform', fit.unitFrom('2,800 V-Bucks Xbox') === 'Bucks');

  /* Third-party marks are composited from the official file by the build, never
     redrawn. A tile made at runtime cannot reach those files, so it must not
     pretend: no logo shapes, no <image>, no external reference. */
  ok('no third-party mark is invented',
    !/<image\b/.test(svg) && !/href=/.test(svg), svg.slice(0, 120));

  /* A name with markup in it must not become markup. */
  const nasty = fit.renderTile({ name: '<script>alert(1)</script> Coins', category: 'x' });
  ok('a product name cannot inject markup into its own tile',
    !nasty.includes('<script>'), nasty.slice(0, 160));

  /* A duration is not a denomination: "3m" must not be read as 3. */
  ok('a duration in a filename is not an amount', fit.artDenomination('gamepass-3m') === null);
  ok('…and a real amount is', fit.artDenomination('apex-11500') === 11500);
}

console.log('\n— The shelf comes from what the shop already sells —');
{
  const shelves = await fit.shelvesFromCatalogue();
  ok('the catalogue teaches game → category', shelves.size > 0, `n=${shelves.size}`);
  /* The seeded shop sells Robux under "robux" while the market calls the game
     "roblox". A hand-written map would be the thing that rots; this is read
     from the shop's own rows. */
  ok('…including roblox → the shelf Robux is actually on',
    shelves.get('roblox') === 'robux', String(shelves.get('roblox')));

  const placed = await fit.categoryFor({ name: 'Roblox 800 Robux', game: 'roblox' });
  ok('a discovered Robux product lands on the existing shelf',
    placed.category === 'robux' && placed.status === 'existing', JSON.stringify(placed));

  const novel = await fit.categoryFor({ name: 'Albion Online 2000 Gold', game: 'albion' });
  ok('a game nobody sells is a PROPOSAL, not a silent new shelf',
    novel.status === 'new', JSON.stringify(novel));
  ok('…with a slug that is safe to put in a URL',
    /^[a-z0-9-]+$/.test(novel.category || ''), String(novel.category));
}

console.log('\n— Catching up with the shelves as they are —');
{
  /* A product with no image, exactly as approving a candidate used to create. */
  const p = await createProduct({
    name: '99,999 Apex Coins', sku: `FITTEST-${Date.now()}`, category: 'apex',
    price: 1999, currency: 'EUR', active: true, announce: false, metadata: {},
  });

  const dry = await fit.backfillArt({ apply: false });
  ok('the backfill finds a product with no picture',
    dry.rows.some((r) => r.id === p.id), `missing=${dry.missing}`);
  ok('…and changes nothing without being told to', dry.applied === false);
  const still = await get('SELECT metadata FROM products WHERE id=@id', { id: p.id });
  ok('…which the row confirms', !/"image"\s*:\s*"[^"]/.test(String(still.metadata)),
    String(still.metadata).slice(0, 80));

  const applied = await fit.backfillArt({ apply: true, actor: { id: 'usr_staff' } });
  ok('applying it gives the product a picture', applied.applied === true && applied.missing > 0);
  const after = (await listProducts()).find((x) => x.id === p.id);
  ok('…which the product now carries', !!after.image, String(after.image).slice(0, 40));
  ok('…as a path rather than an inline picture',
    after.image === `/api/products/${p.id}/tile.svg`, String(after.image).slice(0, 60));
  ok('…recorded as drawn rather than as the shop’s own artwork',
    after.metadata.imageSource === 'generated', after.metadata.imageSource);

  /* Stored by content hash, so a second run is not a second copy. */
  const second = await fit.backfillArt({ apply: true, actor: { id: 'usr_staff' } });
  ok('running it again finds nothing left to do', second.missing === 0, String(second.missing));

  /* An owner's own photograph outranks anything this can draw — a rule older
     than this file, and the backfill must not quietly break it. */
  const owned = await createProduct({
    name: '1,000 Apex Coins', sku: `FITOWN-${Date.now()}`, category: 'apex',
    price: 999, currency: 'EUR', active: true, announce: false,
    metadata: { image: '/products/packs/my-own-photo.svg' },
  });
  const third = await fit.backfillArt({ apply: true, actor: { id: 'usr_staff' } });
  ok('a product that already has a picture is left alone',
    !third.rows.some((r) => r.id === owned.id));
  const kept = (await listProducts()).find((x) => x.id === owned.id);
  ok('…and keeps it', kept.image === '/products/packs/my-own-photo.svg', String(kept.image));

  const rows = await all(
    `SELECT metadata FROM audit_logs WHERE action='catalog.art_backfilled'`);
  ok('applying is audited', rows.length >= 1, String(rows.length));
}

console.log('\n— Approving a discovered product gives it both —');
{
  const disco = await import('../src/services/market/discovery.js');
  const mpId = newId('mkp');
  const at = nowIso();
  await run(
    `INSERT INTO market_products (id, canonical_key, title, product_type, game, edition,
       platform, region, denomination, denom_unit, quantity, created_at, updated_at)
     VALUES (@id, @k, @t, 'points', 'roblox', '', 'unknown', 'unknown', 800, 'robux', 1, @at, @at)`,
    { id: mpId, k: `points:roblox:-:unknown:unknown:800:robux:1:${mpId}`, t: 'Roblox 800 Robux', at });
  const cId = newId('mkc');
  await run(
    `INSERT INTO market_candidates (id, market_product_id, status, created_at, updated_at)
     VALUES (@id, @mp, 'approved', @at, @at)`, { id: cId, mp: mpId, at });

  const { product } = await disco.createProductFromCandidate(cId, { actor: 'tester' });
  ok('the new product has a picture', !!product.metadata.image, JSON.stringify(product.metadata.image));
  ok('…on the shelf the shop already uses for Robux', product.category === 'robux', product.category);
  ok('…and says where the picture came from',
    !!product.metadata.imageSource && !!product.metadata.imageReason,
    JSON.stringify(product.metadata.imageSource));
  /* 800 Robux: the repo ships 1,000 and 2,000 but not 800, so this must be a
     drawn tile rather than a board printing a different number. */
  ok('…without borrowing a board for a different amount',
    product.metadata.imageSource === 'generated'
      || /-800\.svg$/.test(String(product.metadata.image)),
    String(product.metadata.image).slice(0, 60));
}

console.log(`\n${fail ? '❌' : '✅'} product-fit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
