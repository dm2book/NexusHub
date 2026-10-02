/**
 * Ad Studio: storyboard on the server, video in the browser.
 *
 *   numbers are spoken the way a person says them, in Dutch and English;
 *   every scene is built from the product row and the catalogue, and what an
 *   angle needs it must have — a "price per 1,000" scene for a gift card, or a
 *   "free Steam" myth, is skipped with the reason, not invented;
 *   only same-origin images reach the canvas (an external one taints the
 *   recording and the export fails);
 *   a premium voice needs the owner's key, costs write access, and says nothing
 *   the claim gate would not print;
 *   the engine's timeline grows to fit the voice, and every cut has its sound.
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
const { config } = await import('../src/config/env.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');
const speak = await import('../../src/lib/adStudio/speak.js');
const studio = await import('../src/services/adStudioService.js');
const engine = await import('../../src/lib/adStudio/engine.js');

console.log('\n— Numbers, as a voice says them —');
{
  const nl = speak.nlNumber;
  ok('1 … 19', nl(1) === 'een' && nl(13) === 'dertien' && nl(19) === 'negentien');
  ok('21 eenentwintig, 22 tweeëntwintig, 23 drieëntwintig', nl(21) === 'eenentwintig' && nl(22) === 'tweeëntwintig' && nl(23) === 'drieëntwintig');
  ok('96 zesennegentig, 99 negenennegentig', nl(96) === 'zesennegentig' && nl(99) === 'negenennegentig');
  ok('100 honderd, 101 honderdeen, 250 tweehonderdvijftig', nl(100) === 'honderd' && nl(101) === 'honderdeen' && nl(250) === 'tweehonderdvijftig');
  ok('1.000 duizend, 1.700 duizend zevenhonderd', nl(1000) === 'duizend' && nl(1700) === 'duizend zevenhonderd');
  ok('13.500 dertienduizend vijfhonderd, 22.500 tweeëntwintigduizend vijfhonderd',
    nl(13500) === 'dertienduizend vijfhonderd' && nl(22500) === 'tweeëntwintigduizend vijfhonderd', nl(22500));
  ok('€9,99 → negen euro negenennegentig', speak.price(999) === 'negen euro negenennegentig');
  ok('€39,99 → negenendertig euro negenennegentig', speak.price(3999) === 'negenendertig euro negenennegentig');
  ok('€2,96 → twee euro zesennegentig', speak.price(296) === 'twee euro zesennegentig');
  ok('€10,00 → tien euro', speak.price(1000) === 'tien euro');
  ok('English: thirteen thousand five hundred', speak.enNumber(13500) === 'thirteen thousand five hundred');
  ok('English: nine euros ninety-nine', speak.price(999, 'en') === 'nine euros ninety-nine');
  ok('written: €9,99 and 13.500 in Dutch', speak.priceText(999) === '€9,99' && speak.countText(13500) === '13.500');
}

/* A small catalogue: two Robux packs, three V-Bucks packs, a gift card. */
const stamp = Date.now();
const P = (name, category, price, meta = {}) => createProduct({ name, sku: `AST-${name.replace(/\W+/g, '')}-${stamp}`, category, price, currency: 'EUR', active: true, announce: false })
  .then(async (p) => { if (Object.keys(meta).length) await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: p.id, m: JSON.stringify(meta) }); return p; });
const robux = await P('1,000 Robux', 'robux', 999, { image: 'https://evil.example/robux.png' });
await P('4,500 Robux', 'robux', 3899);
const vb1 = await P('1,000 V-Bucks', 'v-bucks', 599);
const vb = await P('13,500 V-Bucks', 'v-bucks', 3999);
await P('2,800 V-Bucks', 'v-bucks', 1299);
const steam = await P('Steam Wallet €10', 'giftcard', 1199);

console.log('\n— The storyboard —');
const R = await studio.buildStoryboard({ productId: robux.id, angles: ['trust', 'myth', 'refund'], length: 45, lang: 'nl' });
{
  ok('scenes: hook, the three chosen angles in order, end', R.scenes.map((s) => s.type).join() === 'hook,trust,myth,refund,end',
    R.scenes.map((s) => s.type).join());
  ok('the hook follows the first angle: never your password', R.scenes[0].data.big === 'STOP.' && R.scenes[0].data.l2 === 'wachtwoord');
  const trust = R.scenes[1];
  ok('Robux goes onto an account: "alleen je gebruikersnaam", spoken with the real field',
    trust.data.l2 === 'gebruikersnaam.' && /alleen je Roblox-gebruikersnaam/.test(trust.voice), trust.voice);
  ok('…with the real price on screen and spoken', trust.data.card[1] === '€9,99' && /negen euro negenennegentig/.test(trust.voice));
  ok('…and the pack counted out: "Duizend Robux", capitalised', /\. Duizend Robux, /.test(trust.voice), trust.voice);
  ok('the myth names the currency', R.scenes[2].data.title === '"Gratis Robux"' && R.scenes[2].data.stamp === 'NEP');
  ok('the end card says the address, spoken', R.scenes[4].voice === 'Forgemarket punt n l. Link in bio.');
  ok('a tracking link for the platform', /utm_source=tiktok&utm_campaign=ad-studio&utm_content=trust-myth-refund-45s/.test(R.link));
  ok('the disclaimer is there', /niet gelieerd/.test(R.disclaimer || ''));
  ok('nothing was refused', R.refused.length === 0, JSON.stringify(R.refused));

  const V = await studio.buildStoryboard({ productId: vb.id, angles: ['math', 'beforeafter'], length: 30, lang: 'nl' });
  const math = V.scenes.find((s) => s.type === 'math');
  ok('maths: the dearest pack against the cheapest, per 1.000 — €5,99 → €2,96', math.data.from === 599 && math.data.to === 296,
    JSON.stringify([math.data.from, math.data.to]));
  ok('…the two real packs on the cards', JSON.stringify(math.data.rows) === '[["1.000 V-Bucks","€5,99"],["13.500 V-Bucks","€39,99"]]', JSON.stringify(math.data.rows));
  ok('…and spoken: "twee euro zesennegentig per duizend"', /twee euro zesennegentig per duizend/.test(math.voice));
  ok('the opening for a maths ad is "Wacht."', V.scenes[0].data.big === 'WACHT.');
  const ba = V.scenes.find((s) => s.type === 'beforeafter');
  ok('before/after counts to the real pack', ba.data.n === 13500 && ba.data.price === '€39,99' && /dertienduizend vijfhonderd/.test(ba.voice));

  const S = await studio.buildStoryboard({ productId: steam.id, angles: ['math', 'myth', 'refund'], length: 30, lang: 'nl' });
  ok('a gift card has no pack: no maths, no myth — skipped, in Dutch, with the reason',
    !S.scenes.some((s) => ['math', 'myth'].includes(s.type)) && S.angles.skipped.length === 2
    && S.angles.skipped.every((x) => /nodig/.test(x.reason)), JSON.stringify(S.angles.skipped));
  ok('…and gets a code, not a username', S.scenes.length >= 3 && /gewoon een code/.test(JSON.stringify(
    (await studio.buildStoryboard({ productId: steam.id, angles: ['trust'], length: 15, lang: 'nl' })).scenes[1].data)));

  const short = await studio.buildStoryboard({ productId: vb.id, angles: ['math', 'beforeafter', 'guest', 'refund'], length: 15, lang: 'nl' });
  ok('15 seconds keeps what fits and says what did not', short.scenes.length === 3
    && short.angles.skipped.some((x) => /past niet in 15 seconden/.test(x.reason)), JSON.stringify(short.angles.skipped));

  const E = await studio.buildStoryboard({ productId: vb.id, angles: ['math'], length: 30, lang: 'en' });
  ok('English: "Do the maths", "per 1,000", spoken in English', E.scenes[1].data.chip === 'Do the maths'
    && E.scenes[1].data.label === 'per 1,000 V-Bucks' && /two euros ninety-six per thousand/.test(E.scenes[1].voice), E.scenes[1].voice);
}

console.log('\n— Only same-origin images reach the canvas —');
{
  const all = R.scenes.flatMap((s) => [s.data.image, ...(s.data.images || [])]).filter(Boolean);
  ok('the external image on the Robux product is never used', !all.some((u) => /evil|^https?:/.test(u)), all.join(','));
  ok('…the category icon is used instead', all.every((u) => /^\/(products|api\/images)\//.test(u)), all.join(','));
  const G = (await studio.buildStoryboard({ productId: robux.id, angles: ['guest'], length: 15, lang: 'nl' })).scenes[1];
  ok('the guest scene shows the product and two other categories', G.data.images.length === 3 && new Set(G.data.images).size === 3, JSON.stringify(G.data.images));
}

console.log('\n— Every word, through the claim gate —');
{
  const words = R.scenes.flatMap((s) => [s.voice, ...Object.values(s.data).filter((v) => typeof v === 'string')]);
  const { gate } = await import('../src/services/adScriptService.js');
  const FACTS = { instant: false, delivery: { n: 0 }, market: null, stats: {} };
  ok('nothing on screen or spoken fails it', words.every((w) => gate(w, FACTS) === null), words.find((w) => gate(w, FACTS)));
}

console.log('\n— Options —');
{
  const o = await studio.studioOptions();
  const byId = Object.fromEntries(o.products.map((p) => [p.id, p]));
  ok('each product lists the angles it can carry', byId[vb.id].angles.includes('math') && !byId[steam.id].angles.includes('math')
    && !byId[steam.id].angles.includes('myth'));
  ok('the six platforms and four lengths', Object.keys(o.platforms).length === 6 && JSON.stringify(o.lengths) === '[15,30,45,60]');
  ok('free browser voices in Dutch and English', o.voices.browser.some((v) => v.lang === 'nl') && o.voices.browser.some((v) => v.lang === 'en'));
  ok('no premium voice without a key', o.voices.premium.elevenlabs === false && o.voices.premium.openai === false);
}

console.log('\n— The engine\'s timeline —');
{
  const t0 = engine.layout(R, {});
  ok('without a voice each scene takes its minimum', Math.abs(t0.total - R.scenes.reduce((a, s) => a + s.minDur, 0)) < 1e-9);
  const t1 = engine.layout(R, { [R.scenes[1].id]: 9 });
  ok('a long voice line stretches its scene, and only its scene',
    Math.abs(t1.scenes[1].dur - (engine.VOICE_AT + 9 + 0.65)) < 1e-9 && t1.scenes[2].start === t1.scenes[1].start + t1.scenes[1].dur);
  ok('sceneAt finds the scene and the seconds into it', engine.sceneAt(t1, t1.scenes[2].start + 0.5).scene.id === t1.scenes[2].id
    && Math.abs(engine.sceneAt(t1, t1.scenes[2].start + 0.5).u - 0.5) < 1e-9);
  const cues = engine.cuesOf(t1);
  ok('a whoosh on every cut', t1.scenes.slice(1).every((s) => cues.some(([k, at]) => k === 'whoosh' && Math.abs(at - s.start) < 1e-9)));
  ok('a riser into the end card', cues.some(([k, at]) => k === 'riser' && Math.abs(at - (t1.scenes[4].start - 0.9)) < 1e-9));
  ok('the myth\'s typing ticks, one per letter', cues.filter(([k, at]) => k === 'tick' && at >= t1.scenes[2].start && at < t1.scenes[2].start + 2).length === 14);
  ok('cues are in time order', cues.every((c, i) => !i || cues[i - 1][1] <= c[1]));
}

console.log('\n— The routes —');
const owner = newId('usr');
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `o-${stamp}@x.dev`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/admin/analytics/ad-studio`;
const H = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
{
  ok('options', (await fetch(`${base}/options`, { headers: H })).status === 200);
  ok('…only for staff', (await fetch(`${base}/options`)).status === 401);
  const sb = await fetch(`${base}/storyboard`, { method: 'POST', headers: H, body: JSON.stringify({ productId: vb.id, angles: ['math'], platform: 'feed', length: 30 }) });
  const body = await sb.json();
  ok('a storyboard for the 4:5 feed', sb.status === 200 && body.platform.w === 1080 && body.platform.h === 1350 && /utm_source=facebook/.test(body.link));
  ok('an unknown product is a 404', (await fetch(`${base}/storyboard`, { method: 'POST', headers: H, body: JSON.stringify({ productId: 'nope' }) })).status === 404);

  const noKey = await fetch(`${base}/voice`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Hallo', provider: 'elevenlabs' }) });
  ok('a premium voice without a key says where to add one', noKey.status === 400 && /Keys and connections/.test((await noKey.json()).error.message));

  /* With a key: the request ElevenLabs receives, and what comes back. */
  config.tts.elevenlabsKey = 'test-key';
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.elevenlabs.io/')) { sent = { url: String(url), init }; return new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), { status: 200 }); }
    return realFetch(url, init);
  };
  const ok1 = await fetch(`${base}/voice`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Bij ForgeMarket geef je alleen je gebruikersnaam.', provider: 'elevenlabs' }) });
  const audio = new Uint8Array(await ok1.arrayBuffer());
  ok('with a key: audio comes back as MP3', ok1.status === 200 && ok1.headers.get('content-type') === 'audio/mpeg' && audio[0] === 73);
  ok('…the key went in the header, the multilingual model was asked for', sent?.init.headers['xi-api-key'] === 'test-key'
    && JSON.parse(sent.init.body).model_id === 'eleven_multilingual_v2');
  const lie = await fetch(`${base}/voice`, { method: 'POST', headers: H, body: JSON.stringify({ text: 'Instant delivery, de beste prijs!', provider: 'elevenlabs' }) });
  ok('…and a claim the shop cannot prove is not spoken', lie.status === 400 && /Refused/.test((await lie.json()).error.message));
  globalThis.fetch = realFetch;
  config.tts.elevenlabsKey = '';
}
srv.close();

console.log('\n— The page —');
{
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const page = read('src/pages/admin/AdStudio.jsx');
  ok('Growth → Ad Studio is in the menu and routed', /growth\/ad-studio.*Ad Studio/.test(read('src/layouts/AdminLayout.jsx'))
    && /path="\/admin\/growth\/ad-studio"/.test(read('src/App.jsx')));
  ok('the free voice is loaded at a pinned version, only on this page', /piper-tts-web@1\.0\.5/.test(page) && !/piper-tts-web/.test(read('package.json')));
  const eng = read('src/lib/adStudio/engine.js');
  ok('MP4 with H.264 is tried before anything else', eng.indexOf("'video/mp4;codecs=avc1.640028") < eng.indexOf("'video/webm"));
}

console.log(`\n${fail ? '❌' : '✅'} ad-studio: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
