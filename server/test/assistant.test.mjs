/**
 * Forge, the storefront assistant.
 *
 * Three things are pinned here, in order of what they cost when broken:
 *  1. It must never repeat the claims the rest of the product stopped making.
 *     The old widget told visitors delivery was instant and checkout took cards.
 *     A shop's own assistant contradicting its checkout is worse than silence.
 *  2. It must answer in the language it was asked in. This is a Dutch shop whose
 *     assistant only understood English.
 *  3. It must answer from real data — prices, stock and order status — or say it
 *     does not know. Never a guess.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_assistant';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { answer, detectLang, quickReplies } = await import('../src/services/assistantService.js');
const { readFileSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { LANG_CODES } = await import(join(ROOT, 'src/lib/i18n/registry.js'));

/** The pending-payment line, per language — the answer to a bare order number. */
const STATUS_TEXT = {
  nl: '⏳ We wachten nog op je betaling. Betaal met je bestelnummer als referentie — de status springt vanzelf om.',
  en: '⏳ We are still waiting for your payment. Pay with your order number as the reference — the status flips by itself.',
  de: '⏳ Wir warten noch auf deine Zahlung. Überweise mit deiner Bestellnummer als Verwendungszweck — der Status springt dann von selbst um.',
  fr: '⏳ Nous attendons encore ton paiement. Paie en indiquant ton numéro de commande comme référence — le statut change tout seul.',
};

const PRODUCTS = [
  { id: 'p1', name: '1,000 Robux', category: 'robux', price: 999, currency: 'EUR', instant: true, stockLeft: 3 },
  { id: 'p2', name: '2,800 V-Bucks', category: 'v-bucks', price: 1999, currency: 'EUR', instant: false, stockLeft: null },
  { id: 'p3', name: 'Steam Wallet €10', category: 'giftcard', price: 1199, currency: 'EUR', instant: true, stockLeft: null },
];
const ORDER = { number: 'FM-2026-8KQ2R7XZ', status: 'pending', statusLabel: 'Pending', totalFormatted: '€9.99' };
const ask = (q, opts = {}) => answer(q, { products: PRODUCTS, lookupOrder: async () => ORDER, ...opts });

console.log('— Honesty —');
{
  const LIES = /instant delivery|within seconds|binnen seconden|direct geleverd|securely by card|met je creditcard|24\/7/i;
  const questions = [
    'how fast is delivery', 'hoe lang duurt de levering', 'how do i pay', 'hoe betaal ik',
    'is it safe', 'is dit betrouwbaar', 'wat kost robux', 'recommend robux', 'refund', 'geld terug',
  ];
  let clean = true;
  for (const q of questions) {
    const r = await ask(q);
    if (LIES.test(r.text)) { clean = false; console.log(`     "${q}" → ${r.text.slice(0, 90)}`); }
  }
  ok('no answer repeats a claim the shop stopped making', clean);

  const pay = await ask('how do i pay?');
  ok('the payment answer describes the real, reference-based flow', /reference/i.test(pay.text));
  ok('the payment answer says there is no card checkout', /no card checkout/i.test(pay.text));

  const del = await ask('how long does delivery take?');
  ok('delivery says in-stock is automatic', /automatically/i.test(del.text));
  ok('delivery says the rest is by hand', /by hand/i.test(del.text));

  const safe = await ask('is this legit or a scam?');
  ok('the trust answer does not oversell', /small dutch shop|not a big company/i.test(safe.text));
  ok('the trust answer includes the never-DM-first warning', /never dm you first/i.test(safe.text));
}

console.log('\n— Dutch —');
{
  ok('detects Dutch', detectLang('hoe lang duurt de levering van mijn bestelling') === 'nl');
  ok('detects English', detectLang('how long does delivery take for my order') === 'en');

  const cases = [
    ['hoe lang duurt de levering?', /voorraad/i],
    ['hoe betaal ik?', /referentie/i],
    ['is dit betrouwbaar of word ik opgelicht?', /kleine Nederlandse winkel/i],
    ['ik heb niks gekregen en wil mijn geld terug', /geld terug/i],
    ['hoe wissel ik mijn robux code in', /roblox\.com\/redeem/i],
    ['waar vul ik mijn vbucks code in', /fortnite\.com\/vbuckscard/i],
    ['heb ik een account nodig', /geen account nodig/i],
    ['bedankt!', /graag gedaan/i],
  ];
  for (const [q, re] of cases) {
    const r = await ask(q, { lang: 'nl' });
    ok(`NL: "${q}"`, re.test(r.text), r.text.slice(0, 80));
  }

  // Asked in Dutch while the UI is English → still answered in Dutch.
  const mixed = await ask('hoe betaal ik met tikkie?', { lang: 'en' });
  ok('answers in the language of the question, not the UI', /referentie/i.test(mixed.text));
}

console.log('\n— Real data —');
{
  const price = await ask('wat kost robux');
  ok('a price question returns real products', price.products?.length > 0);
  ok('it returns the matching product', price.products?.[0]?.name === '1,000 Robux');
  ok('it carries the real price', price.products?.[0]?.price === 999);
  ok('it carries the honest stock flag', price.products?.[0]?.instant === true);
  ok('it never invents a price in prose', !/€\s?\d/.test(price.text));

  const vb = await ask('recommend me some vbucks');
  ok('an alias finds the product (vbucks → V-Bucks)', vb.products?.[0]?.name === '2,800 V-Bucks');
  ok('an out-of-stock item is described as delivered by hand', /by hand/i.test(vb.text));

  const gift = await ask('do you have steam gift cards');
  ok('a gift-card question finds the gift card', gift.products?.[0]?.category === 'giftcard');

  const none = await ask('what does a mountain bike cost', { products: PRODUCTS });
  ok('an unknown product is admitted, not guessed', /cannot find/i.test(none.text));
}

console.log('\n— Orders —');
{
  const r = await ask('waar blijft FM-2026-8KQ2R7XZ?', { lang: 'nl' });
  ok('an order number is looked up', r.order?.number === 'FM-2026-8KQ2R7XZ');
  ok('the status is explained in buyer language', /wachten nog op je betaling/i.test(r.text));
  ok('it offers the track page', r.actions?.includes('track'));

  const missing = await answer('FM-2026-NOPE1234', { products: PRODUCTS, lookupOrder: async () => null });
  ok('an unknown order does not pretend to know', /do not know that order number/i.test(missing.text));

  const delivered = await answer('FM-2026-8KQ2R7XZ', {
    products: PRODUCTS, lookupOrder: async () => ({ ...ORDER, status: 'completed' }) });
  ok('a delivered order says where the code went', /emailed/i.test(delivered.text));

  const noLookup = await answer('FM-2026-8KQ2R7XZ', { products: PRODUCTS });
  ok('without a lookup it points at the track page instead of failing', /order number/i.test(noLookup.text));
}

console.log('\n— Edges —');
{
  ok('empty input greets instead of throwing', (await ask('')).text.length > 0);
  ok('nonsense gets an honest fallback', /do not have a good answer/i.test((await ask('asdkjhasd qwe')).text));
  ok('the fallback offers a human', (await ask('asdkjhasd qwe')).actions?.includes('discord'));
  ok('an empty catalog does not crash', (await answer('wat kost robux', { products: [] })).text.length > 0);
  ok('a very long message is handled', (await ask('a'.repeat(500))).text.length > 0);
  ok('every answer has text', [
    await ask('hi'), await ask('thanks'), await ask('discord'), await ask('login'),
  ].every((r) => typeof r.text === 'string' && r.text.length > 0));
}

console.log('\n— All four languages, end to end —');
{
  /* This section exists because of a failure that was not a translation gap.
     The widget's chrome — title, greeting, buttons, the offline notice — was
     already written in German and French, so a visitor on /de met a fully
     German assistant. The endpoint's zod schema was still
     `z.enum(['nl','en'])`, so the first thing they typed came back 400.
     Not a worse answer in German: no answer in German. */
  const { CHAT_LANGS } = await import('../src/services/assistantService.js');
  ok('the assistant knows every language the shop is read in',
    LANG_CODES.every((c) => CHAT_LANGS.includes(c)), `knows ${CHAT_LANGS.join(',')}`);

  const route = readFileSync(join(ROOT, 'server/src/routes/catalog.js'), 'utf8');
  ok('/api/chat validates against that list rather than its own copy of it',
    /lang: z\.enum\(CHAT_LANGS\)/.test(route),
    'a hand-written enum here is how German became a 400');

  /* Asked in a language, answered in it — checked by a word that exists in
     that language only, not by "it returned something". */
  const MARK = {
    nl: [['hoe lang duurt levering', 'voorraad'], ['hoe betaal ik', 'referentie']],
    en: [['how long does delivery take', 'stock'], ['how do i pay', 'reference']],
    de: [['wie lange dauert die lieferung', 'Lager'], ['wie bezahle ich', 'Verwendungszweck']],
    fr: [['combien de temps pour la livraison', 'stock'], ['comment je paie', 'référence']],
  };
  for (const [lang, cases] of Object.entries(MARK)) {
    for (const [q, word] of cases) {
      const r = await ask(q, { lang });
      ok(`[${lang}] "${q}" answers in ${lang}`, r.text.toLowerCase().includes(word.toLowerCase()),
        `got: ${r.text.slice(0, 70)}`);
    }
  }

  /* A message with no language marker at all keeps the page's language.
     Ties used to resolve by list order, which handed a French reader English. */
  for (const lang of LANG_CODES) {
    const r = await ask('FM-2026-8KQ2R7XZ', { lang });
    ok(`[${lang}] a bare order number is answered in the page's language`,
      r.text === `**FM-2026-8KQ2R7XZ** — ${STATUS_TEXT[lang]}`, `got: ${r.text.slice(0, 60)}`);
  }

  /* The single most common thing typed into a shop's chat: a game name, on its
     own. It used to reach the "I do not have a good answer" line — and only
     ever worked by accident, for categories with four packs or fewer. Robux,
     the best-selling thing here, has more than four. */
  for (const lang of LANG_CODES) {
    const r = await ask('Robux', { lang });
    ok(`[${lang}] a bare product name lists the packs`,
      Array.isArray(r.products) && r.products.length > 0 && r.products[0].name.includes('Robux'),
      `got: ${r.text.slice(0, 60)}`);
  }

  /* …but an intent still wins over a product name it happens to contain. */
  const refund = await ask('Robux niet aangekomen', { lang: 'nl' });
  ok('a refund question that names a product is still a refund answer',
    !refund.products && refund.text.includes('geld terug'), refund.text.slice(0, 60));

  ok('quick replies exist in every language',
    LANG_CODES.every((c) => quickReplies(c).length === 4)
    && new Set(LANG_CODES.map((c) => quickReplies(c)[0])).size === LANG_CODES.length,
    'two languages share a first suggestion — one of them is falling back');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
