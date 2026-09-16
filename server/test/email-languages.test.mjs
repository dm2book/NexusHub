/**
 * A buyer reads the shop in one language and must get their email in it.
 *
 * The storefront speaks four languages; email_templates held one row per
 * template, so there was one language for everyone. A German buyer paid in
 * German and received a Dutch confirmation — useless to them, and coming from a
 * shop they had never bought from before, indistinguishable from a phishing
 * mail. That is the version of this that costs the sale rather than an apology.
 *
 * The half that is easy to miss is the generated half. Several tokens in these
 * templates are filled by code — the order summary, the withdrawal footnote,
 * the redeem instructions for the category that was bought — and all of it was
 * hardcoded Dutch. Translating the templates alone would have produced a German
 * email with a Dutch summary inside it, which is worse than one honest
 * language. Every assertion below therefore checks a rendered email, not a
 * dictionary.
 */
process.env.LAUNCH_MODE = 'open';

const { migrate } = await import('../src/db/migrate.js');
const { seed } = await import('../src/db/seed.js');
const { seedDemoCatalog } = await import('../src/db/demoSeed.js');
const { run, get, all } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createOrder, markPaymentReceived, renderOrderEmail } = await import('../src/services/orderService.js');
const { langFor } = await import('../src/services/emailService.js');
const { TEMPLATE_TRANSLATIONS } = await import('../src/services/templateTranslations.js');
const { DEFAULT_TEMPLATES } = await import('../src/services/defaultTemplates.js');
const { emailCopy, redeemSteps, redeemFallback, EMAIL_LANGS } = await import('../src/services/emailCopy.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

await migrate();
await seed();
await seedDemoCatalog();

console.log('— Every template exists in every language —');
{
  const rows = await all(`SELECT lang, COUNT(*) AS n FROM email_templates GROUP BY lang ORDER BY lang`);
  const byLang = Object.fromEntries(rows.map((r) => [r.lang, Number(r.n)]));
  ok('four languages are seeded', Object.keys(byLang).length === 4, JSON.stringify(byLang));
  ok('each has all thirteen templates',
    Object.values(byLang).every((n) => n === DEFAULT_TEMPLATES.length), JSON.stringify(byLang));

  /* A template that gains a token has to gain it everywhere. A mail that
     renders {{order.url}} as an empty string in one language only is the kind
     of thing nobody sees until a buyer cannot find their code. */
  const tokensOf = (s) => [...String(s).matchAll(/\{\{([a-zA-Z.]+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const drift = [];
  for (const t of DEFAULT_TEMPLATES) {
    const want = tokensOf(t.body_html);
    for (const [lang, byId] of Object.entries(TEMPLATE_TRANSLATIONS)) {
      if (tokensOf(byId[t.id].body_html) !== want) drift.push(`${t.id}/${lang}`);
    }
  }
  ok('and every language carries the same tokens', drift.length === 0, drift.join(', '));
}

console.log('\n— The whole email follows the buyer, not just the template —');
{
  const card = await get(`SELECT id FROM products WHERE category='giftcard' AND active=1 LIMIT 1`);
  await run(`INSERT INTO product_codes (id, product_id, code, status, created_at)
    VALUES (@id,@p,'LANG-TEST-CODE','available',@a)`,
  { id: newId('pc'), p: card.id, a: new Date().toISOString() });

  /* One marker per language for each half of the mail: a word from the
     TEMPLATE, and a word from a block the SERVER generates. Both have to move. */
  const EXPECT = {
    nl: { subject: /Bedankt voor je bestelling/, total: /Totaal/, withdrawal: /Herroepingsrecht/,
      eyebrow: 'Bestelling ontvangen', foot: 'Bestelling volgen' },
    en: { subject: /Thanks for your order/, total: /Total/, withdrawal: /Right of withdrawal/,
      eyebrow: 'Order received', foot: 'Track order' },
    de: { subject: /Danke für deine Bestellung/, total: /Gesamt/, withdrawal: /Widerrufsrecht/,
      eyebrow: 'Bestellung eingegangen', foot: 'Bestellung verfolgen' },
    fr: { subject: /Merci pour ta commande/, total: /Total/, withdrawal: /Droit de rétractation/,
      eyebrow: 'Commande reçue', foot: 'Suivre ma commande' },
  };
  for (const [lang, want] of Object.entries(EXPECT)) {
    const order = await createOrder({
      email: `${lang}@example.com`, currency: 'EUR', consent: true, consentText: 'ok',
      items: [{ productId: card.id, quantity: 1 }],
      billing: { full_name: 'T', city: 'A', email: `${lang}@example.com`, lang },
    });
    const mail = await renderOrderEmail(order.id, 'order_received');
    const body = text(mail.html);
    ok(`[${lang}] the subject is written in it`, want.subject.test(mail.subject), mail.subject);
    ok(`[${lang}] …and the order summary the server generates`, want.total.test(body));
    ok(`[${lang}] …and the withdrawal-right footnote`, want.withdrawal.test(body));
    /* The frame around the letter, on a mail that really went through
       renderTemplate. Asserting on wrapBranded directly proves the tables are
       complete and nothing else: it takes the language as an argument, so it
       passes just as happily when the send path never works out which language
       to hand it — which is exactly how the header, the two promises and the
       whole footer stayed Dutch on every German mail. */
    ok(`[${lang}] …and the header saying which mail this is`, body.includes(want.eyebrow),
      `expected "${want.eyebrow}"`);
    /* Read out of the footer block, not out of the whole mail. "Bestellung
       verfolgen" is also the label on the button inside the German letter, so
       searching the page passed while the footer under it was still Dutch. */
    const foot = text((mail.html.match(/<div class="foot">[\s\S]*?<\/div>\s*<\/div>/) || [''])[0]);
    ok(`[${lang}] …and the footer links`, foot.includes(want.foot),
      `expected "${want.foot}" in: ${foot.slice(0, 90)}`);
    const strays = Object.entries(EXPECT)
      .filter(([l, o]) => l !== lang && foot.includes(o.foot)).map(([l]) => l);
    ok(`[${lang}] …with no other language left in the footer`, strays.length === 0, strays.join(', '));
  }
}

console.log('\n— The redeem instructions follow it too —');
{
  /* This is the one that would have been missed: a translated template with a
     Dutch "Zo wissel je je code in" block sitting inside it. */
  const card = await get(`SELECT id FROM products WHERE category='giftcard' AND active=1 LIMIT 1`);
  await run(`INSERT INTO product_codes (id, product_id, code, status, created_at)
    VALUES (@id,@p,'LANG-DELIVERED','available',@a)`,
  { id: newId('pc'), p: card.id, a: new Date().toISOString() });
  const order = await createOrder({
    email: 'de-delivered@example.com', currency: 'EUR', consent: true, consentText: 'ok',
    items: [{ productId: card.id, quantity: 1 }],
    billing: { full_name: 'T', city: 'A', email: 'de-delivered@example.com', lang: 'de' },
  });
  await markPaymentReceived(order.id, 'psp_lang', { actorId: 't', reason: 'r' });
  await new Promise((r) => setTimeout(r, 1200));
  const mail = await renderOrderEmail(order.id, 'order_completed');
  const body = text(mail.html);
  ok('a delivered German order explains itself in German',
    /So löst du deine Guthabenkarte ein/.test(body), body.slice(0, 160));
  ok('…and carries no Dutch left over from the generator',
    !/Zo wissel je|Inwisselen op|Subtotaal/.test(body));
}

console.log('\n— Falling back is safe, and never silent about the wrong thing —');
{
  ok('an unknown language falls back to the shop’s own', langFor({ lang: 'zz' }) === 'nl');
  ok('no language at all falls back too', langFor({}) === 'nl');
  ok('an order carries its own', langFor({ order: { lang: 'fr' } }) === 'fr');
  ok('a user row carries it when there is no order', langFor({ user: { lang: 'de' } }) === 'de');

  ok('the copy table knows the same four languages',
    EMAIL_LANGS.join(',') === 'nl,en,de,fr', EMAIL_LANGS.join(','));
  ok('an unlisted language still gets Dutch phrases, not undefined',
    emailCopy('zz').total === 'Totaal');
  ok('a category with no recipe still gets usable guidance',
    !!redeemFallback('fr').title && redeemSteps('fr', 'not-a-category') === null);
  /* Every language needs a recipe for every category that has one, or a French
     buyer gets German steps for Robux and Dutch ones for a gift card. */
  const cats = ['robux', 'v-bucks', 'valorant', 'discord-nitro', 'giftcard', 'gamepass', 'spotify', 'minecraft'];
  const gaps = EMAIL_LANGS.flatMap((l) => cats.filter((c) => !redeemSteps(l, c)).map((c) => `${l}/${c}`));
  ok('every language has a recipe for every category that has one', gaps.length === 0, gaps.join(', '));
}

console.log('\n— The language reaches mail that has no order behind it —');
{
  const api = await import('../src/routes/auth.js').then(() => null).catch(() => null);
  void api;
  const users = await all(`SELECT column_name FROM information_schema.columns
                            WHERE table_name='users' AND column_name='lang'`);
  ok('users carry a language for login codes and reminders', users.length === 1);

  const card = await get(`SELECT id FROM products WHERE category='giftcard' AND active=1 LIMIT 1`);
  const uid = newId('usr');
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id, @e, @a, @a)`,
    { id: uid, e: 'member@example.com', a: new Date().toISOString() });
  await createOrder({
    userId: uid, email: 'member@example.com', currency: 'EUR', consent: true, consentText: 'ok',
    items: [{ productId: card.id, quantity: 1 }],
    billing: { full_name: 'M', city: 'A', email: 'member@example.com', lang: 'fr' },
  });
  const after = await get('SELECT lang FROM users WHERE id=@id', { id: uid });
  ok('…and ordering in one records it against the person', after?.lang === 'fr', String(after?.lang));
}

console.log('\n— …and so does the frame around it —');
{
  /* The bodies were translated; the frame was not.
     A German delivery mail arrived with GELEVERD printed across its header, two
     Dutch promises under the letter and a Dutch footer — three Dutch fragments
     wrapped around a German letter, from a shop the buyer had never bought
     from before. That is not a rough edge, it is the thing that makes a real
     email look like a forged one, which is the exact failure the rest of this
     file exists to prevent. Nothing caught it because every assertion above
     reads the BODY. */
  const { EMAIL_THEMES, wrapBranded } = await import('../src/services/templateService.js');
  const LANGS = ['nl', 'en', 'de', 'fr'];

  const tables = Object.values(EMAIL_THEMES)
    .flatMap((t) => [t.eyebrow, ...(t.pills || [])]);
  ok(`all ${tables.length} header and footer strings exist in every language`,
    tables.every((t) => LANGS.every((l) => typeof t[l] === 'string' && t[l].length > 0)),
    'a missing one prints the Dutch, or nothing at all');

  /* An unknown language must still produce a sentence rather than `undefined`
     in someone's inbox. */
  const odd = wrapBranded('<p>letter</p>', { theme: EMAIL_THEMES.order_completed, lang: 'pt' });
  ok('an unwritten language falls back to a real sentence', !/undefined/.test(odd));

  /* One action colour. Half the templates draw their button as an inline
     table hardcoded to the brand purple; the .btn class followed the mail's
     accent, so a delivery mail had a green header and a purple button while a
     refund had purple and purple. */
  const green = wrapBranded('<p>x</p>', { theme: EMAIL_THEMES.order_completed, lang: 'nl' });
  const purple = wrapBranded('<p>x</p>', { theme: EMAIL_THEMES.refund_issued, lang: 'nl' });
  const btnOf = (html) => (html.match(/a\.btn\{[^}]*\}/) || [''])[0];
  ok('the button is the same colour in every mail', btnOf(green) === btnOf(purple) && btnOf(green).length > 0);
  ok('…and it is the brand purple the templates already hardcode',
    /#7c5cff/.test(btnOf(green)), btnOf(green).slice(0, 80));
  ok('…while the header still follows the mail\'s own accent',
    green.includes('#34d399') && purple.includes('#a855f7'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} email-languages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
