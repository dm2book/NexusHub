/**
 * Product content: a short and a long description, an FAQ, an SEO title, an
 * SEO description and keywords for every product — written only from what the
 * shop knows, and scored.
 *
 *   every catalogue product gets a full set in Dutch and English, inside the
 *   lengths search engines show;
 *   nothing in it promises a delivery time, speed, or a guarantee beyond the
 *   written refund rule — a product whose own name would make it do so is
 *   refused, not published;
 *   the score is 0–100 and the three flags — missing description, weak SEO,
 *   duplicate content — say what is wrong;
 *   applying writes the description, keeps every language in metadata, and
 *   leaves a description the owner wrote alone when asked to.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const svc = await import('../src/services/productContentService.js');
const { CATALOG } = await import('../src/db/demoSeed.js');

console.log('\n— Generating —');
{
  const sets = CATALOG.map((p) => ({ p, g: svc.generateAll(p) }));
  const refused = sets.filter((s) => !s.g.ok);
  ok(`every catalogue product (${CATALOG.length}) gets content`, refused.length === 0, refused.map((s) => s.p.name).join(', '));
  const all = sets.filter((s) => s.g.ok).flatMap((s) => svc.LANGS.map((l) => ({ p: s.p, c: s.g.content[l] })));
  ok('…in Dutch and English', sets.every((s) => !s.g.ok || (s.g.content.nl && s.g.content.en)));
  ok('…with a short and a long description', all.every(({ c }) => c.short.length > 30 && c.short.length <= 160 && c.long.split('\n\n').length >= 3));
  ok('…an SEO title of at most 60 characters', all.every(({ c }) => c.seoTitle.length <= 60 && c.seoTitle.includes('ForgeMarket')), all.find(({ c }) => c.seoTitle.length > 60)?.c.seoTitle);
  ok('…an SEO description of at most 160', all.every(({ c }) => c.seoDescription.length >= 70 && c.seoDescription.length <= 160));
  ok('…three or more FAQ entries', all.every(({ c }) => c.faq.length >= 3 && c.faq.every(([q, a]) => q && a)));
  ok('…and five to twelve keywords', all.every(({ c }) => c.keywords.length >= 5 && c.keywords.length <= 12));
  const text = all.flatMap(({ c }) => [c.short, c.long, c.seoTitle, c.seoDescription, ...c.faq.flat(), ...c.keywords]).join('\n');
  ok('no delivery time or speed anywhere', !/\b(direct|meteen|instant|snel|binnen \d|minuten|seconden|fast|minutes|within|right away|immediately)\b/i.test(text));
  ok('no guarantee, “cheapest” or “best”', !/\b(garantie|gegarandeerd|guarantee|goedkoopst|cheapest|beste|best)\b/i.test(text));
  ok('the one promise is the written refund rule, with where it is written', /niet geleverd.*geld terug/i.test(text) && text.includes('forgemarket.nl/refunds'));

  const robux = svc.generateContent(CATALOG.find((p) => p.category === 'robux'), 'nl');
  ok('an account top-up names what is needed — and says never the password', /gebruikersnaam/.test(robux.short) && /nooit je wachtwoord/.test(robux.short)
    && robux.faq.some(([q]) => /wachtwoord/.test(q)));
  const steam = svc.generateContent(CATALOG.find((p) => /steam/i.test(p.name)), 'nl');
  ok('a gift card is a code by email, and the platform comes from its name', /code per e-mail/.test(steam.short + steam.seoDescription) && steam.keywords.includes('steam cadeaukaart'));
  ok('…and asks nothing about a password', !steam.faq.some(([q]) => /wachtwoord/.test(q)));
  const vb = svc.generateContent(CATALOG.find((p) => p.category === 'v-bucks'), 'en');
  ok('the platform comes from the category (V-Bucks → Fortnite)', /Fortnite/.test(vb.seoTitle + vb.short));
  const eu = svc.generateContent({ name: 'PlayStation Store €20 EU', category: 'giftcard' }, 'nl');
  ok('a region in the name is stated, with a question about it', /regio EU/.test(eu.long) && eu.faq.some(([q]) => /land/.test(q)));
}

console.log('\n— The claim gate —');
{
  for (const bad of ['Direct geleverd na betaling', 'Binnen 5 minuten in je account', 'Gegarandeerd de goedkoopste',
    'Delivered within minutes', 'Instant delivery', '100% veilig', 'De beste webshop van Nederland', 'Snel en betrouwbaar']) {
    ok(`refuses “${bad}”`, svc.refusesClaim(bad));
  }
  ok('lets a plain statement through', !svc.refusesClaim('Je krijgt een code per e-mail.'));
  const g = svc.generateAll({ name: '1,000 Robux Instant Delivery', category: 'robux' });
  ok('a product whose own name makes a claim gets nothing, and the refusal says why', !g.ok && g.refused.some((r) => /Instant/.test(r)));
}

console.log('\n— Score and flags —');
{
  const none = svc.scoreContent({ name: 'X', description: '' });
  ok('no description, no SEO: score 0', none.score === 0);
  ok('…flagged Missing description and Weak SEO', none.flags.includes('missing_description') && none.flags.includes('weak_seo'));
  const p = CATALOG.find((x) => x.category === 'robux');
  const g = svc.generateAll(p).content;
  const full = svc.scoreContent({ ...p, description: g.nl.long, metadata: { content: g } });
  ok('a full generated set scores 100 with no flags', full.score === 100 && full.flags.length === 0, JSON.stringify(full));
  const dup = svc.scoreContent({ ...p, description: g.nl.long, metadata: { content: g } }, { duplicate: true });
  ok('…the same copy on two products is flagged Duplicate content and loses points', dup.flags.includes('duplicate_content') && dup.score === 85);
  const thin = svc.scoreContent({ name: 'X', description: 'Robux.', metadata: { content: { nl: { seoTitle: 'Robux', seoDescription: 'Kopen', faq: [], keywords: [] } } } });
  ok('a one-word description is still missing, and a short title is weak SEO', thin.flags.includes('missing_description') && thin.flags.includes('weak_seo') && thin.score === 10);
  ok('the score stays within 0–100', [none, full, dup, thin].every((s) => s.score >= 0 && s.score <= 100));
}

console.log('\n— Report, apply and admin —');
{
  const { createApp, ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { run, get, nowIso } = await import('../src/db/index.js');
  const { newId } = await import('../src/utils/ids.js');
  const { finalizeLogin } = await import('../src/services/authService.js');
  const { createProduct, getProduct } = await import('../src/services/productService.js');
  const tag = Date.now().toString(36);
  const same = 'Een beschrijving die op twee producten precies hetzelfde staat, woord voor woord.';
  const a = await createProduct({ name: `400 Robux ${tag}`, category: 'robux', price: 499, description: same, announce: false });
  const b = await createProduct({ name: `800 Robux ${tag}`, category: 'robux', price: 899, description: same, announce: false });
  const own = await createProduct({ name: `Steam Wallet €5 ${tag}`, category: 'giftcard', price: 600,
    description: 'Een beschrijving die de eigenaar zelf schreef, lang genoeg om te tellen als echte productbeschrijving.', announce: false });
  const bare = await createProduct({ name: `Xbox Gift Card €15 ${tag}`, category: 'giftcard', price: 1600, announce: false });

  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `o-${owner}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id: owner }), {});
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api/admin/products`;
  const H = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

  const rep = await (await fetch(`${base}/content`, { headers: H })).json();
  const row = (id) => rep.items.find((i) => i.id === id);
  ok('the report scores every active product, with an average', rep.items.length === rep.total && Number.isInteger(rep.average));
  ok('…flags the shared description on both products', row(a.id)?.flags.includes('duplicate_content') && row(b.id)?.flags.includes('duplicate_content'));
  ok('…flags a product with no description', row(bare.id)?.flags.includes('missing_description'));
  ok('…and counts each flag', ['missing_description', 'weak_seo', 'duplicate_content'].every((k) => rep.flags[k] >= 1));
  ok('…worst first', rep.items.every((i, n) => n === 0 || rep.items[n - 1].score <= i.score));
  ok('…not for a visitor', (await fetch(`${base}/content`)).status === 401);

  const pre = await (await fetch(`${base}/${bare.id}/content/preview`, { headers: H })).json();
  ok('a preview shows the set and writes nothing', pre.ok && pre.content.nl.seoTitle && !(await getProduct(bare.id)).description);

  const ap = await (await fetch(`${base}/content/apply`, { method: 'POST', headers: H, body: JSON.stringify({ productIds: [a.id, own.id, bare.id], onlyMissing: true }) })).json();
  const after = await getProduct(bare.id);
  ok('the English text goes in `description` (what the English site reads), the Dutch in descriptionNl',
    /^[A-Z0-9].*\b(You|We)\b/.test(after.description) && /\b(Je|We zetten|Afrekenen)\b/.test(after.metadata.descriptionNl || ''), JSON.stringify([after.description.slice(0, 80), (after.metadata.descriptionNl || '').slice(0, 80)]));
  const { describeProduct } = await import('../../src/lib/productCopy.js');
  const { withCopy } = await import('../src/services/productCopy.js');
  const shown = withCopy(after);
  ok('…so each language shows its own text', describeProduct(shown, 'en') === after.description && describeProduct(shown, 'nl') === after.metadata.descriptionNl);

  /* Products written before the fix: Dutch in `description`. The migration moves it. */
  const { MIGRATIONS } = await import('../src/db/migrations.js');
  const fix = MIGRATIONS.find((m) => m.id === '058_generated_copy_language');
  const broken = await createProduct({ name: `Xbox Game Pass 1 maand EU ${tag}`, category: 'gamepass', price: 1499, announce: false,
    description: 'NL tekst die gegenereerd was', metadata: { source: 'discovery', content: { nl: { long: 'NL tekst die gegenereerd was' }, en: { long: 'English text that was generated' } } } });
  const owned = await createProduct({ name: `Owner copy ${tag}`, category: 'robux', price: 999, announce: false,
    description: 'Written by the owner', metadata: { content: { nl: { long: 'iets anders' }, en: { long: 'something else' } } } });
  await run(fix.sql);
  const fixed = await getProduct(broken.id);
  ok('the repair puts the generated English back in `description` and the Dutch in descriptionNl',
    fixed.description === 'English text that was generated' && fixed.metadata.descriptionNl === 'NL tekst die gegenereerd was');
  ok('…renames "1 maand" to "1 Month" on discovery products', /Xbox Game Pass 1 Month EU/.test(fixed.name), fixed.name);
  ok('…and never touches a description the owner wrote', (await getProduct(owned.id)).description === 'Written by the owner');

  ok('applying writes the long description and keeps both languages in metadata',
    ap.applied === 2 && ap.rows.find((r) => r.id === a.id)?.status === 'applied' && after.description.length > 120 && after.metadata.content?.nl?.faq?.length >= 3 && after.metadata.content?.en && after.metadata.content.generatedAt);
  ok('…leaves the description the owner wrote', (await getProduct(own.id)).description.startsWith('Een beschrijving die de eigenaar') && ap.rows.find((r) => r.id === own.id)?.status === 'kept');
  const rep2 = await (await fetch(`${base}/content`, { headers: H })).json();
  ok('…and the product now scores 100 with no flags', rep2.items.find((i) => i.id === bare.id)?.score === 100 && !rep2.items.find((i) => i.id === bare.id).flags.length);
  ok('…the duplicate is gone for the one rewritten', !rep2.items.find((i) => i.id === a.id).flags.includes('duplicate_content'));
  srv.close();

  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../src/pages/admin/ProductContent.jsx', import.meta.url), 'utf8');
  ok('the admin page shows the score and the three flags', page.includes('/100') && ['Missing description', 'Weak SEO', 'Duplicate content'].every((t) => page.includes(t)));
  const seo = fs.readFileSync(new URL('../src/routes/seo.js', import.meta.url), 'utf8');
  ok('the product page head uses the generated SEO title and description when there is one', /content\?\.nl\?\.seoTitle/.test(seo) && /content\?\.nl\?\.seoDescription/.test(seo));
}

console.log(`\n${fail ? '❌' : '✅'} product-content: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
