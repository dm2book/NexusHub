/**
 * The fifty UGC scripts in Ad Studio.
 *
 *   fifty scripts, ten themes of five, each four beats that open on a problem;
 *   no price is written in a script — every one is read from the catalogue,
 *   on screen as "€9,99" and in the voice as "negen euro negenennegentig";
 *   a price change shows up in the line, and a change that breaks a script's
 *   sum switches the script off with the reason instead of showing a lie;
 *   every line, written and spoken, passes the claim gate — no speed, no
 *   "cheapest", no "best shop", no "shop now";
 *   the storyboard route gives four beats in the 0–2 / 2–5 / 5–10 / 10–15 s
 *   windows, with a tracking link per script.
 */
import './_selling-shop.mjs';   // must come first — see that file
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');
const { CATALOG } = await import('../src/db/demoSeed.js');
const { UGC_SCRIPTS, THEMES, BEATS, BEAT_DUR, skusOf } = await import('../src/services/ugcScripts.js');
const ugc = await import('../src/services/ugcStudioService.js');
const { GENERIC } = await import('../src/services/adScriptService.js');
const { validateText } = await import('../../scripts/ad/claims.mjs');
const engine = await import('../../src/lib/adStudio/engine.js');
const fs = await import('node:fs');
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* Every product a script reads is on sale, at the catalogue's own price. */
const needed = [...new Set(UGC_SCRIPTS.flatMap(skusOf))];
for (const sku of needed) {
  const row = CATALOG.find((c) => c.sku === sku);
  const have = await get(`SELECT id FROM products WHERE sku=@s`, { s: sku });
  if (!have) await createProduct({ name: row.name, sku, category: row.category, price: row.price, currency: 'EUR', active: true, announce: false });
  else await run(`UPDATE products SET active=1, price=@p WHERE sku=@s`, { s: sku, p: row.price });
}
const priceOf = (sku) => CATALOG.find((c) => c.sku === sku).price;

console.log('\n— Fifty scripts —');
{
  const ids = UGC_SCRIPTS.map((s) => s.id);
  ok('fifty, numbered ugc-01 … ugc-50', ids.length === 50 && ids.every((id, i) => id === `ugc-${String(i + 1).padStart(2, '0')}`));
  const per = Object.keys(THEMES).map((t) => UGC_SCRIPTS.filter((s) => s.theme === t).length);
  ok('ten themes of five', per.length === 10 && per.every((n) => n === 5), per.join(','));
  ok('every script has the four beats', UGC_SCRIPTS.every((s) => BEATS.every((b) => typeof s[b] === 'function')));
  ok('the beats fill the brief: 2 + 3 + 5 + 4 = 14 s', BEAT_DUR.hook === 2 && BEAT_DUR.problem === 3 && BEAT_DUR.solution === 5 && BEAT_DUR.cta === 4);
  const src = read('server/src/services/ugcScripts.js');
  ok('no price is written in a script — every one comes from the catalogue', !/€\s?\d/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('…and no pack size either', !/\$\.n\(\d/.test(src));
}

console.log('\n— Read against the catalogue —');
const opts = await ugc.ugcOptions();
{
  ok('all fifty run on today\'s catalogue', opts.scripts.every((s) => s.available), opts.scripts.filter((s) => !s.available).map((s) => `${s.id}: ${s.reason}`).join('; '));
  const s11 = opts.scripts.find((s) => s.id === 'ugc-11');
  ok('a price on screen is the catalogue price, written the Dutch way', s11.lines.problem.includes('€9,99') && s11.lines.solution.includes('€79,99'), s11.lines.solution);
  ok('…and the price per 1.000 is the sum, not a number typed in', s11.lines.solution.includes('€8,00 per duizend'), s11.lines.solution);
  const s13 = opts.scripts.find((s) => s.id === 'ugc-13');
  ok('"ten times" is ten times the price, and the difference is the difference', s13.lines.problem.includes('€99,90') && s13.lines.solution.includes('€19,91'), JSON.stringify(s13.lines));
}

console.log('\n— What a line may say —');
{
  const cat = await ugc.catalogue();
  const forbidden = /\b(goedkoopst\w*|beste|best|instant\w*|direct geleverd|snel\w*|seconden|minuten|shop now|koop (het )?nu|bestel (het )?nu|klanten|reviews?|sterren|gegarandeerd)\b/i;
  const bad = [], digits = [];
  for (const s of UGC_SCRIPTS) {
    const r = ugc.resolveScript(s, cat);
    for (const b of BEATS) {
      for (const t of [r.lines[b].text, r.lines[b].voice]) {
        if (!validateText(t).ok || GENERIC.some((g) => g.re.test(t)) || forbidden.test(t)) bad.push(`${s.id}/${b}: ${t}`);
      }
      if (/[€\d]/.test(r.lines[b].voice)) digits.push(`${s.id}/${b}: ${r.lines[b].voice}`);
    }
  }
  ok('no line claims speed, "cheapest", a best shop, ratings or customer counts', !bad.length, bad.join(' | '));
  ok('the voice says every number in words — no "€" or digit reaches the speech engine', !digits.length, digits.join(' | '));
  const r1 = ugc.resolveScript(UGC_SCRIPTS[0], cat);
  ok('a Robux script asks for the username and says so in the checkout picture', r1.props.solution.kind === 'username' && r1.props.solution.field === 'Roblox-gebruikersnaam');
  ok('the hook opens on a frustration, as the brief asks', /Ik dacht echt dat gratis Robux werkte/.test(r1.lines.hook.text));
  ok('addresses are spoken: forgemarket punt n l slash refunds', ugc.spokenSite('forgemarket.nl/refunds') === 'forgemarket punt n l slash refunds');
  ok('"1,000 Robux" is written "1.000 Robux" in a Dutch ad', ugc.dutchName('1,000 Robux') === '1.000 Robux' && ugc.dutchName('22,500 Robux') === '22.500 Robux');
  ok('pack sizes are read from the name, any unit', ugc.sizeOf('1,720 Minecoins — Minecraft') === 1720 && ugc.sizeOf('12,000 FC Points — EA FC') === 12000);
  const gift = ugc.resolveScript(UGC_SCRIPTS.find((s) => s.id === 'ugc-33'), cat);
  ok('a gift card tile shows no "price per 1.000", and an unlike-for-like row lights no winner',
    gift.props.solution.packs.find((p) => /Steam/.test(p.name)).per === null && gift.props.solution.highlight === false);
}

console.log('\n— A price changes —');
{
  await run(`UPDATE products SET price=8499 WHERE sku='ROBUX-10000'`);
  let o = await ugc.ugcOptions();
  ok('the line follows the new price', o.scripts.find((s) => s.id === 'ugc-11').lines.solution.includes('€84,99'));
  await run(`UPDATE products SET price=10500 WHERE sku='ROBUX-10000'`);
  o = await ugc.ugcOptions();
  const s13 = o.scripts.find((s) => s.id === 'ugc-13');
  ok('a price that breaks the sum switches the script off, with the reason', !s13.available && /rekensom/.test(s13.reason), JSON.stringify(s13));
  ok('…and the other scripts that need that sum too', ['ugc-11', 'ugc-34'].every((id) => !o.scripts.find((s) => s.id === id).available));
  await run(`UPDATE products SET price=@p WHERE sku='ROBUX-10000'`, { p: priceOf('ROBUX-10000') });
  await run(`UPDATE products SET active=0 WHERE sku='NITRO-1Y'`);
  o = await ugc.ugcOptions();
  const s42 = o.scripts.find((s) => s.id === 'ugc-42');
  ok('a product taken off sale switches its script off', !s42.available && /NITRO-1Y/.test(s42.reason));
  await run(`UPDATE products SET active=1 WHERE sku='NITRO-1Y'`);
}

console.log('\n— The routes —');
const owner = newId('usr');
const stamp = Date.now();
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `u-${stamp}@x.dev`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/admin/analytics/ad-studio`;
const H = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
{
  const list = await (await fetch(`${base}/ugc`, { headers: H })).json();
  ok('the list: fifty scripts and the themes', list.scripts?.length === 50 && Object.keys(list.themes).length === 10);
  ok('…not for a visitor', (await fetch(`${base}/ugc`)).status === 401);
  const r = await fetch(`${base}/ugc/storyboard`, { method: 'POST', headers: H, body: JSON.stringify({ scriptId: 'ugc-01', platform: 'reels' }) });
  const b = await r.json();
  ok('a storyboard: four beats in order', r.status === 200 && b.scenes.map((s) => s.type).join() === 'ugc-hook,ugc-problem,ugc-solution,ugc-cta', JSON.stringify(b).slice(0, 300));
  ok('…14 seconds of minimum, a tight tail after each line', b.scenes.reduce((a, s) => a + s.minDur, 0) === 14 && b.scenes.every((s) => s.tail === 0.3));
  ok('…the picture under each line: fake login, then the checkout field', b.scenes[1].data.prop.kind === 'scam' && b.scenes[2].data.prop.kind === 'username');
  ok('…the end card is the product with its real price', b.scenes[3].data.product.price === '€9,99' && b.scenes[3].data.product.name === '1.000 Robux');
  ok('…a tracking link per script and platform', /utm_source=instagram&utm_campaign=ugc&utm_content=ugc-01$/.test(b.link), b.link);
  ok('…the brand disclaimer on the last card', /niet gelieerd/.test(b.disclaimer || ''));
  ok('unknown script → 404', (await fetch(`${base}/ugc/storyboard`, { method: 'POST', headers: H, body: JSON.stringify({ scriptId: 'ugc-99' }) })).status === 404);
  ok('not a script id → 400', (await fetch(`${base}/ugc/storyboard`, { method: 'POST', headers: H, body: JSON.stringify({ scriptId: '../x' }) })).status === 400);
  await run(`UPDATE products SET active=0 WHERE sku='ROBUX-1000'`);
  const off = await fetch(`${base}/ugc/storyboard`, { method: 'POST', headers: H, body: JSON.stringify({ scriptId: 'ugc-01' }) });
  ok('a script that cannot run → 409 with the reason', off.status === 409 && /ROBUX-1000/.test((await off.json()).error.message));
  await run(`UPDATE products SET active=1 WHERE sku='ROBUX-1000'`);

  console.log('\n— The engine —');
  const tl = engine.layout(b, { '1-hook': 2.6, '2-problem': 1.0 });
  ok('a beat lasts as long as its line plus a short tail, or its window', Math.abs(tl.scenes[0].dur - (engine.VOICE_AT + 2.6 + 0.3)) < 1e-9 && tl.scenes[1].dur === 3);
  const cues = engine.cuesOf(tl).map((c) => c[0]);
  ok('every beat has its sound: the impact, the error buzz, the check, the riser into the end card',
    ['impact', 'buzz', 'check', 'riser', 'ding'].every((k) => cues.includes(k)), cues.join(','));
}
srv.close();

console.log('\n— The page —');
{
  const page = read('src/pages/admin/AdStudio.jsx');
  ok('Ad Studio opens on the UGC scripts, with the product ad one tab away', /useState\('ugc'\)/.test(page) && /mode-\$\{k\}/.test(page));
  ok('your own clip stays in your browser — an object URL, never uploaded', /URL\.createObjectURL\(file\)/.test(page) && !/FormData/.test(page));
  ok('the four beats are shown with their windows before you render', /0–2s/.test(page) && /10–15s/.test(page));
}

console.log(`\n${fail ? '❌' : '✅'} ugc-scripts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
