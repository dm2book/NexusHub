import { Link } from 'react-router-dom';
import { MapPin, Mail, MessageCircle, Building2 } from 'lucide-react';
import { LEGAL, legalComplete, legalAddressLine } from '../../lib/legalIdentity.js';
import { SUPPORT_EMAIL } from '../../lib/support.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Who is selling, in one block, used wherever a buyer goes looking: the About
 * page, Contact, and the footer.
 *
 * Dutch and EU law require a webshop to state its identity and a reachable
 * address before someone buys (BW 6:230m). This shop is not registered with the
 * Kamer van Koophandel yet, and a KvK number is the one thing here that cannot
 * be improvised — printing a fake or a "coming soon" would be worse than the
 * truth, because a buyer can look a real number up in seconds and find nothing.
 *
 * So every field renders ONLY when it holds a real value, and while the legally
 * required set is incomplete the block says so in plain words instead of
 * implying a company that does not exist. An honest "run by one person in the
 * Netherlands, not a registered company" reads as candour; a blank row or an
 * invented number reads as a scam.
 *
 * Fill the fields in src/lib/legalIdentity.js and this upgrades itself
 * everywhere at once — no other file needs touching.
 */
export default function SellerIdentity({ compact = false }) {
  const { t } = useI18n();
  const complete = legalComplete();
  const address = legalAddressLine();

  if (compact) {
    return (
      <div className="text-[13px] text-slate-500 leading-relaxed">
        <div className="font-semibold text-slate-700">{LEGAL.tradeName}{LEGAL.legalName ? ` — ${LEGAL.legalName}` : ''}</div>
        {address && <div>{address}</div>}
        {!complete && <div>{t('seller.compactPrivate', 'Run by one person in the Netherlands. Not a registered company (yet).')}</div>}
        {LEGAL.kvk && <div>{t('seller.kvk', 'KvK')}: {LEGAL.kvk}</div>}
        {LEGAL.vat && <div>{t('seller.vat', 'VAT')}: {LEGAL.vat}</div>}
        <div className="mt-1">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-block py-1 min-h-[24px] hover:text-violet-600 transition">{SUPPORT_EMAIL}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6 sm:p-7">
      <h2 className="text-white text-xl font-bold mb-1.5">{t('seller.title', 'Who you are buying from')}</h2>
      <p className="text-slate-400 text-sm mb-5 max-w-2xl leading-relaxed">
        {t('seller.sub', 'Not a faceless storefront. Here is exactly who is behind this shop and how to reach them — before you pay, not after.')}
      </p>

      <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            {t('seller.who', 'Seller')}
          </dt>
          <dd className="text-slate-200">
            {LEGAL.tradeName}
            {LEGAL.legalName && <span className="text-slate-400"> — {LEGAL.legalName}</span>}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1.5">
            <MapPin size={12} /> {t('seller.based', 'Based in')}
          </dt>
          <dd className="text-slate-200">{address || LEGAL.country}</dd>
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1.5">
            <Building2 size={12} /> {t('seller.registration', 'Registration')}
          </dt>
          <dd className="text-slate-200">
            {LEGAL.kvk
              ? <>{t('seller.kvk', 'KvK')} {LEGAL.kvk}{LEGAL.vat ? ` · ${t('seller.vat', 'VAT')} ${LEGAL.vat}` : ''}</>
              /* Deliberately NOT amber. Not being KvK-registered is a neutral
                 fact about a private seller, not a warning — and colouring it
                 like one makes the most eye-catching thing on a trust page look
                 like a confession. Stated plainly, with the reassurance that
                 actually matters to the reader carrying the weight. */
              : <>{t('seller.notRegistered', 'Not registered with the Kamer van Koophandel yet — this is a private seller. Your rights as a consumer, including the money-back guarantee, are the same either way.')}</>}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1.5">
            <Mail size={12} /> {t('seller.contact', 'Contact')}
          </dt>
          <dd className="text-slate-200">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-violet-300 hover:text-violet-200 transition">{SUPPORT_EMAIL}</a>
            <span className="block text-slate-400 mt-0.5">
              <Link to="/discord" className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200 transition">
                <MessageCircle size={12} /> {t('seller.discord', 'ForgeMarket Support on Discord')}
              </Link>
            </span>
          </dd>
        </div>
      </dl>

      {!complete && (
        <p className="text-[12.5px] text-slate-500 mt-5 pt-4 border-t border-white/5 leading-relaxed">
          {t('seller.incomplete', 'A full postal address is still being added here. Until it is, you can reach a real person on Discord or by email — and if an order cannot be delivered you get your money back, which is the part that actually protects you.')}
        </p>
      )}
    </div>
  );
}
