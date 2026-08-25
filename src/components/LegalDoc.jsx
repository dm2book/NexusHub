import InfoShell from './InfoShell.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { SUPPORT_EMAIL } from '../lib/support.js';
import { LEGAL, legalComplete, legalAddressLine, vatStatement } from '../lib/legalIdentity.js';

/**
 * Renders one legal document from src/content.
 *
 * The seller identity is injected from legalIdentity.js rather than written into
 * each document, so the address can never be current on one page and stale on
 * another — and so filling it in once updates all four at the same moment.
 */

/** Minimal **bold** support. Legal prose needs emphasis; it does not need a
 *  markdown parser, and shipping one to render four documents would be silly. */
function RichText({ children }) {
  const parts = String(children).split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**')
        ? <strong key={i} className="text-slate-200 font-semibold">{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>))}
    </>
  );
}

/**
 * Who is selling.
 *
 * Dutch and EU consumer law require a trader to state this before someone buys
 * (Art. 6:230m BW). Every field renders only when it is filled in, so an unset
 * value is left out rather than printed as an empty row — and when the legally
 * required minimum is missing, the page says so plainly instead of quietly
 * looking complete. Bluffing on the page about legal compliance would be the
 * worst possible place to do it.
 */
function SellerIdentity({ nl }) {
  if (!legalComplete()) {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3.5 text-slate-300 text-[15px] leading-relaxed">
        {nl
          ? <>De volledige naam en het adres van de verkoper staan hier nog niet gepubliceerd. De Nederlandse wet vereist die vóór verkoop aan consumenten. Lees je dit en ontbreken ze nog, vraag ze dan bij ons op voordat je bestelt{SUPPORT_EMAIL ? <> — via <b className="text-white">{SUPPORT_EMAIL}</b></> : ''}.</>
          : <>The seller’s full name and address are not published here yet. Dutch law requires them before selling to consumers. If you are reading this and they are still missing, ask us for them before you order{SUPPORT_EMAIL ? <> — at <b className="text-white">{SUPPORT_EMAIL}</b></> : ''}.</>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-slate-300 text-[15px] leading-relaxed">
      <b className="text-white">{LEGAL.tradeName}</b>{LEGAL.legalName ? ` — ${LEGAL.legalName}` : ''}<br />
      {legalAddressLine()}<br />
      {SUPPORT_EMAIL && <>{nl ? 'E-mail' : 'Email'}: <b className="text-white">{SUPPORT_EMAIL}</b><br /></>}
      {LEGAL.kvk
        ? <>KvK-nummer: {LEGAL.kvk}<br /></>
        : <>{nl
          ? 'ForgeMarket wordt gedreven door een particulier en is niet ingeschreven bij de Kamer van Koophandel.'
          : 'ForgeMarket is run by a private individual and is not registered with the Chamber of Commerce.'}<br /></>}
      {LEGAL.vat && <>{nl ? 'Btw-identificatienummer' : 'VAT number'}: {LEGAL.vat}</>}
    </div>
  );
}

function Body({ items, nl }) {
  return items.map((item, i) => {
    if (typeof item === 'string') {
      return <p key={i} className="text-slate-400 leading-relaxed"><RichText>{item}</RichText></p>;
    }
    if (item.identity) return <SellerIdentity key={i} nl={nl} />;
    /* A sentence the seller identity decides, not the document.
       The terms used to assert "all prices include VAT" flatly, in both
       languages, with nothing in the system to back it. Now the claim is made
       only when a BTW number is actually published — see vatStatement(). */
    if (item.token === 'vatStatement') {
      return <p key={i} className="text-slate-400 leading-relaxed"><RichText>{vatStatement(nl)}</RichText></p>;
    }
    if (item.note) {
      return (
        <div key={i} className="rounded-xl border border-indigo-400/30 bg-indigo-400/10 px-4 py-3.5 text-slate-300 leading-relaxed">
          <RichText>{item.note}</RichText>
        </div>
      );
    }
    if (item.ul) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1.5 text-slate-400">
          {item.ul.map((li, j) => <li key={j} className="leading-relaxed"><RichText>{li}</RichText></li>)}
        </ul>
      );
    }
    if (item.table) {
      return (
        // Scrolls inside its own box: a retention table on a 390px screen would
        // otherwise push the whole page sideways.
        <div key={i} className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-[14.5px] border-collapse">
            <tbody>
              {item.table.map(([k, v], j) => (
                <tr key={j} className="border-b border-white/5 last:border-0 align-top">
                  <th scope="row" className="text-left font-medium text-slate-200 px-4 py-2.5 w-2/5 min-w-[140px]">
                    <RichText>{k}</RichText>
                  </th>
                  <td className="text-slate-400 px-4 py-2.5 leading-relaxed"><RichText>{v}</RichText></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return null;
  });
}

/** A date a human reads, in the language they are reading the page in. */
export const formatUpdated = (iso, nl) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(nl ? 'nl-NL' : 'en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function LegalDoc({ doc, children }) {
  const { lang } = useI18n();
  const nl = lang === 'nl';
  const d = nl ? doc.nl : doc.en;

  return (
    <InfoShell eyebrow={d.eyebrow} title={d.title} subtitle={d.subtitle}>
      <p className="text-slate-500 text-sm mb-8">
        {nl ? 'Laatst bijgewerkt' : 'Last updated'}: {formatUpdated(doc.updated, nl)}
      </p>
      <div className="space-y-4">
        {d.sections.map((s, i) => (
          <section key={i} className="space-y-4">
            {s.h && <h2 className="text-white text-xl font-display mt-8 mb-2 scroll-mt-24">{s.h}</h2>}
            <Body items={s.body} nl={nl} />
          </section>
        ))}
      </div>
      {children}
    </InfoShell>
  );
}
