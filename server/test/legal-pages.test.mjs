/**
 * The four legal documents.
 *
 * These are the pages a buyer reads before trusting a shop they have never
 * heard of, and the pages that decide whether a chargeback dispute is winnable.
 * They are also the easiest thing on the site to let go stale: nothing breaks
 * when a policy stops describing reality, so nobody notices.
 *
 * The tests are therefore about facts, not prose. Two kinds:
 *
 *  1. Legally required content — the statutory withdrawal right and its digital
 *     exception, the 14-day refund period, refund by the same method, the model
 *     withdrawal form, the AP as supervisory authority, the ODR platform.
 *  2. Claims that must match how the shop actually works. The version this
 *     replaces promised refunds "via Tikkie / Revolut / PayPal" long after
 *     payments had moved to Mollie, and described bank transfer with a manual
 *     reference as the only way to pay.
 */
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { LEGAL_DOCS } = await import('../../src/content/legal.js');
const { REFUND_DOC } = await import('../../src/content/refunds.js');
const fs = await import('node:fs');

const DOCS = { ...LEGAL_DOCS, refunds: REFUND_DOC };

/** Every string in a document, flattened, for whole-document assertions. */
const textOf = (doc, lang) => {
  const out = [];
  const walk = (items) => {
    for (const item of items) {
      if (typeof item === 'string') { out.push(item); continue; }
      if (item.note) out.push(item.note);
      if (item.ul) out.push(...item.ul);
      if (item.table) for (const row of item.table) out.push(...row);
    }
  };
  const d = doc[lang];
  for (const s of d.sections) { if (s.h) out.push(s.h); walk(s.body); }
  if (d.form) out.push(d.form.h, d.form.intro, ...d.form.lines);
  return out.join('\n');
};

const nl = (key) => textOf(DOCS[key], 'nl');
const en = (key) => textOf(DOCS[key], 'en');

// ── Structure ────────────────────────────────────────────────────────────────
console.log('— All four documents exist, in both languages —');
{
  for (const key of ['terms', 'privacy', 'cookies', 'refunds']) {
    const d = DOCS[key];
    ok(`${key}: present in Dutch and English`,
      !!d?.nl?.sections?.length && !!d?.en?.sections?.length);
    ok(`${key}: has a title, subtitle and page description in both languages`,
      ['nl', 'en'].every((l) => d[l].title && d[l].subtitle && d[l].meta));
    // A legal document whose date moves is a document that claims to have been
    // revised today, every day. The old pages rendered `new Date()`.
    ok(`${key}: carries a fixed publication date`,
      /^\d{4}-\d{2}-\d{2}$/.test(d.updated || ''), d.updated);
    ok(`${key}: that date is real and not in the future`,
      !Number.isNaN(Date.parse(d.updated)) && Date.parse(d.updated) <= Date.now() + 86_400_000);
    // Both languages must say the same things. A section count that drifts is
    // how one language quietly loses a paragraph.
    ok(`${key}: both languages have the same number of sections`,
      d.nl.sections.length === d.en.sections.length,
      `nl ${d.nl.sections.length} vs en ${d.en.sections.length}`);
  }
  ok('the English versions say Dutch is authoritative',
    ['terms', 'privacy', 'cookies', 'refunds']
      .every((k) => /authoritative/i.test(en(k))));
}

// ── Seller identity ──────────────────────────────────────────────────────────
console.log('— Who is selling —');
{
  const hasIdentity = (doc, lang) =>
    doc[lang].sections.some((s) => s.body.some((b) => b?.identity === true));
  // Art. 6:230m BW: the trader has to be identifiable before the buyer commits.
  ok('the terms name the seller', hasIdentity(DOCS.terms, 'nl') && hasIdentity(DOCS.terms, 'en'));
  ok('the privacy policy names the controller',
    hasIdentity(DOCS.privacy, 'nl') && hasIdentity(DOCS.privacy, 'en'));

  // Rendered from one module so it cannot be current on one page and stale on
  // another, and so filling it in once updates all of them.
  const comp = fs.readFileSync('../src/components/LegalDoc.jsx', 'utf8');
  ok('identity is rendered from legalIdentity.js, not written into each document',
    /from '\.\.\/lib\/legalIdentity\.js'/.test(comp));
  ok('a missing legal name is stated plainly rather than left looking complete',
    /legalComplete\(\)/.test(comp) && /nog niet gepubliceerd/.test(comp));
}

// ── Right of withdrawal ──────────────────────────────────────────────────────
console.log('— Herroepingsrecht —');
{
  const t = nl('terms'), r = nl('refunds');

  ok('the terms state the 14-day cooling-off period', /14 dagen bedenktijd/.test(t));
  // The exception is what makes "no refund after delivery" lawful rather than a
  // shop inventing its own rule. Stating the conclusion without the basis is
  // exactly what the previous refund page did.
  ok('the terms cite the statutory exception for digital content',
    /6:230p/.test(t), 'art. 6:230p sub e BW must be named');
  ok('the refund policy cites it too', /6:230p/.test(r));
  ok('both explain the tick box as express prior consent',
    /uitdrukkelijke/.test(t) && /vinkje/.test(t) && /vinkje/.test(r));
  ok('both say an undelivered order can still be cancelled',
    /nog niet geleverd/i.test(t) && /nog niet geleverd/i.test(r));
  ok('the English versions carry the same citation',
    /6:230p/.test(en('terms')) && /6:230p/.test(en('refunds')));

  // Required to be made available, and it has to be usable.
  ok('a model withdrawal form is provided in both languages',
    !!REFUND_DOC.nl.form?.lines?.length && !!REFUND_DOC.en.form?.lines?.length);
  ok('the form leaves room for the order number and the dates',
    /Bestelnummer/.test(r) && /Besteld op/.test(r));
  ok('the form is not presented as the only route',
    /niet verplicht/.test(r), 'an email must be stated as equally valid');
}

// ── Refunds ──────────────────────────────────────────────────────────────────
console.log('— Terugbetaling —');
{
  const r = nl('refunds'), t = nl('terms');
  // The statutory maximum. Its absence was the biggest omission in the old page.
  ok('the refund period is stated', /binnen 14 dagen/.test(r) && /14 dagen/.test(t));
  ok('refunds go back by the same payment method',
    /dezelfde betaalmethode/.test(r) && /dezelfde betaalmethode/.test(t));
  ok('no fee is charged for a refund', /geen kosten/.test(r));
  ok('store credit is addressed', /winkeltegoed/.test(r));
  ok('there are three named ways to ask', /bestelpagina/.test(r) && /Discord/.test(r));
  ok('the English version states the period and the method',
    /within 14 days/.test(en('refunds')) && /same payment method/.test(en('refunds')));
}

// ── The policies describe THIS shop ─────────────────────────────────────────
console.log('— Matching reality —');
{
  const t = nl('terms'), p = nl('privacy'), r = nl('refunds');

  ok('the terms name the payment provider', /Mollie/.test(t));
  ok('…and the methods actually offered',
    ['iDEAL', 'Bancontact', 'Apple Pay', 'creditcard', 'PayPal'].every((m) => t.includes(m)));
  ok('the terms say payment confirms automatically', /automatisch bevestigd/.test(t));
  ok('the privacy policy lists Mollie as a processor', /Mollie/.test(p));
  ok('…and says card details never reach us', /geen betaalgegevens/i.test(p));

  // The stale claims the previous versions carried.
  const stale = /Tikkie|Revolut/;
  ok('no policy still promises refunds via Tikkie or Revolut',
    !stale.test(r) && !stale.test(en('refunds')), 'payments moved to Mollie');
  ok('the refund policy no longer implies manual-only payment',
    !/handmatig bevestigd/.test(r));

  // Fraud screening holds deliveries now; a buyer is entitled to know that can
  // happen before they order, not only when their code fails to arrive.
  ok('the terms disclose that an order may be checked before delivery',
    /niet automatisch geleverd/.test(t) && /mens/.test(t));
  ok('the refund policy explains what a held order means for the money',
    /gecontroleerd/.test(r) && /elke cent terug/.test(r));
  ok('the privacy policy explains the fraud screening',
    /risicoscore|fraudesignalen/i.test(p) && /IP-adres/.test(p));
  // Art. 22 GDPR: a purely automated refusal would need a different basis and a
  // different set of rights. The shop escalates to a person, so it must say so.
  ok('…and states no decision is taken by automated means alone',
    /nooit uitsluitend geautomatiseerd/.test(p));
}

// ── Privacy specifics ────────────────────────────────────────────────────────
console.log('— AVG —');
{
  const p = nl('privacy');
  ok('every legal basis is named with its article',
    ['sub b', 'sub f', 'sub c', 'sub a'].every((x) => p.includes(x)));
  ok('the supervisory authority is named', /Autoriteit Persoonsgegevens/.test(p));
  ok('the tax retention period is stated', /7 jaar/.test(p));
  ok('retention is given per category, not as one vague sentence',
    DOCS.privacy.nl.sections.some((s) => s.body.some((b) => b?.table?.length >= 5)));
  ok('data subject rights are listed', /dataportabiliteit/.test(p) && /bezwaar/.test(p));
  ok('transfers outside the EU are addressed', /standaardcontractbepalingen/.test(p));
  ok('processors are named individually', ['Vercel', 'Neon', 'Resend', 'Discord'].every((x) => p.includes(x)));
  ok('the response period for a request is stated', /binnen één maand/.test(p));
  ok('the English version names the GDPR articles',
    /Art\. 6\(1\)\(b\)/.test(en('privacy')) && /Article 22/.test(en('privacy')));
}

// ── Cookies ──────────────────────────────────────────────────────────────────
console.log('— Cookies —');
{
  const c = nl('cookies');
  // The legal basis for having no banner. Claiming "we don't need consent"
  // without the reason is the kind of thing that reads as an excuse.
  ok('the cookie policy cites the Telecommunicatiewet', /11\.7a/.test(c));
  ok('…and explains why there is no banner', /geen cookiebanner/.test(c));
  ok('the one cookie is documented by name and retention',
    /fm_session/.test(c) && /30 dagen/.test(c));
  ok('localStorage is distinguished from cookies',
    /geen cookies/.test(c) && /winkelwagen/.test(c));
  ok('third-party payment cookies are disclosed', /Mollie/.test(c));
  ok('it says how to delete them', /instellingen van je browser/.test(c));
  ok('the English version cites the same law', /11\.7a/.test(en('cookies')));
}

// ── Wiring ───────────────────────────────────────────────────────────────────
console.log('— Reachable —');
{
  const app = fs.readFileSync('../src/App.jsx', 'utf8');
  for (const [path, kind] of [['/terms', 'terms'], ['/privacy', 'privacy'], ['/cookies', 'cookies']]) {
    ok(`${path} is routed`, new RegExp(`path="${path}"[^>]*kind="${kind}"`).test(app));
  }
  ok('/refunds is routed', /path="\/refunds"/.test(app));
  // The URLs a Dutch buyer actually types, and that a Discord message tends to
  // use. A 404 on /voorwaarden is a trust problem, not a routing detail.
  ok('Dutch-language URLs work too',
    ['/voorwaarden', '/privacybeleid', '/cookiebeleid', '/retourbeleid']
      .every((u) => app.includes(`path="${u}"`)));

  const footer = fs.readFileSync('../src/components/store/StoreFooter.jsx', 'utf8');
  ok('all four are linked from the footer',
    ["'/refunds'", "'/terms'", "'/privacy'", "'/cookies'"].every((u) => footer.includes(u)));

  const catalog = fs.readFileSync('src/routes/catalog.js', 'utf8');
  ok('the legal pages are in the sitemap',
    ["'/terms'", "'/privacy'", "'/cookies'", "'/refunds'"].every((u) => catalog.includes(u)));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} legal pages: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
