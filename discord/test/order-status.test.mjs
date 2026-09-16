/**
 * /order tells a buyer what is happening and whether they need to act.
 * Runs without Postgres or a Discord token — pure payload → view.
 */
import { orderStatusView, ORDER_STATE, ORDER_UI, BOT_LANGS, botLang, say } from '../src/orderStatus.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const base = { number: 'FM-2026-8KQ2R7XZ', total: 999, currency: 'EUR', totalFormatted: '€9.99' };

console.log('— /order status view —');

// Waiting on the buyer: amber, and the reference must be right there.
{
  const v = orderStatusView({ ...base, status: 'pending', history: [{ to: 'pending', at: '2026-07-25T10:00:00.000Z' }] });
  ok('pending is amber', v.color === 0xf5b324, `#${v.color.toString(16)}`);
  ok('pending shows the payment reference', v.fields.some((f) => f.value.includes(base.number)));
  ok('pending explains what the buyer must do', /reference/i.test(v.description));
}

// Waiting on us: no call to action, no reference clutter.
{
  const v = orderStatusView({ ...base, status: 'payment_received', history: [] });
  ok('paid is blue', v.color === 0x38bdf8);
  ok('paid says nothing is required from the buyer', /nothing left for you to do/i.test(v.description));
  ok('paid drops the payment reference', !v.fields.some((f) => f.name === 'Payment reference'));
  ok('paid never promises instant delivery', !/instant/i.test(v.description));
}

// Done.
{
  const v = orderStatusView({ ...base, status: 'completed', history: [] });
  ok('delivered is green', v.color === 0x22c55e);
  ok('delivered says where the code went', /email/i.test(v.description));
  ok('delivered offers a route when it is missing', /spam|ticket/i.test(v.description));
}

// Money back.
{
  const v = orderStatusView({ ...base, status: 'refunded', history: [] });
  ok('refunded gives a real timeframe', /1–3 working days/.test(v.description));
}

// Unknown status must degrade, never crash or show a raw enum as the headline.
{
  const v = orderStatusView({ ...base, status: 'quantum_superposition', statusLabel: 'In limbo', history: [] });
  ok('an unknown status still renders', typeof v.title === 'string' && v.title.length > 0);
  ok('an unknown status uses the human label', v.title.includes('In limbo'));
}

// History is rendered as Discord relative timestamps, in the reader's own locale.
{
  const v = orderStatusView({ ...base, status: 'completed',
    history: [{ to: 'pending', at: '2026-07-25T10:00:00.000Z' }, { to: 'completed', at: '2026-07-25T10:05:00.000Z' }] });
  const progress = v.fields.find((f) => f.name === 'Progress').value;
  ok('progress uses Discord timestamps', /<t:\d+:R>/.test(progress));
  ok('progress uses human titles, not enums', progress.includes('Delivered') && !progress.includes('payment_received'));
}

// A malformed timestamp must not produce "Invalid Date" in a customer's face.
{
  const v = orderStatusView({ ...base, status: 'completed', history: [{ to: 'completed', at: 'not-a-date' }] });
  const progress = v.fields.find((f) => f.name === 'Progress').value;
  ok('a broken timestamp degrades quietly', !/Invalid|NaN/.test(progress), progress);
}

// Every status the store can emit needs a mapping — a missing one shows a raw enum.
{
  const STORE_STATUSES = ['pending', 'payment_received', 'processing', 'awaiting_fulfillment', 'completed', 'refunded', 'cancelled', 'failed'];
  /* `?.next` on its own stopped meaning anything the moment `next` became a
     table of languages: an object is truthy whether or not it holds a word.
     This asks for a sentence, in every language, which is the thing the buyer
     actually reads. */
  const written = (table) => BOT_LANGS.every((l) => typeof table?.[l] === 'string' && table[l].length > 10);
  ok('every store status has buyer-facing copy', STORE_STATUSES.every((s) => written(ORDER_STATE[s]?.next)),
    STORE_STATUSES.filter((s) => !ORDER_STATE[s]).join(', '));
}

console.log('\n— …and it is readable by the member who asked —');
{
  /* The shop sells across the border and its storefront, its emails and its
     on-site assistant all answer in the buyer's language. /order — the place a
     worried buyer goes when the email has not arrived — answered everyone in
     English. Discord sends the member's own locale with every interaction, so
     there was never anything for anyone to configure. */
  ok('the bot writes every language the shop is read in', BOT_LANGS.length >= 4, BOT_LANGS.join(','));

  for (const [locale, want] of [['nl', 'nl'], ['de', 'de'], ['fr', 'fr'], ['en-GB', 'en'],
    ['en-US', 'en'], ['pt-BR', 'en'], [undefined, 'en'], ['', 'en']]) {
    ok(`locale ${locale ?? '(none)'} → ${want}`, botLang(locale) === want, botLang(locale));
  }

  /* One marker word per language rather than "it returned a string": a
     fallback returns a string too. */
  const MARK = { nl: 'betaling', en: 'payment', de: 'Zahlung', fr: 'paiement' };
  for (const [lang, word] of Object.entries(MARK)) {
    const v = orderStatusView({ ...base, status: 'pending', history: [] }, { lang });
    ok(`[${lang}] the title and the next step are in ${lang}`,
      `${v.title} ${v.description}`.toLowerCase().includes(word.toLowerCase()),
      `${v.title} — ${v.description.slice(0, 50)}`);
  }

  /* The furniture too. A German embed with English field names is the version
     that looks like nobody checked. */
  for (const lang of BOT_LANGS) {
    const v = orderStatusView({ ...base, status: 'pending', history: [] }, { lang });
    const names = v.fields.map((f) => f.name);
    ok(`[${lang}] the field names are translated as well`,
      names[0] === ORDER_UI.progress[lang] && names.includes(ORDER_UI.reference[lang]),
      names.join(', '));
    ok(`[${lang}] …and so is the footer and the author line`,
      v.footer === ORDER_UI.live[lang] && v.author.startsWith(ORDER_UI.order[lang]),
      `${v.author} / ${v.footer}`);
  }

  /* Nothing in this file may reach a buyer as `undefined`. */
  const tables = [...Object.values(ORDER_STATE).flatMap((st) => [st.title, st.next]), ...Object.values(ORDER_UI)];
  ok(`all ${tables.length} copy tables are complete`,
    tables.every((t) => BOT_LANGS.every((l) => typeof t[l] === 'string' && t[l].length > 0)),
    'a missing language shows nothing at all');
  ok('…and an unknown language still says something', say(ORDER_UI.total, 'xx') === ORDER_UI.total.en);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
