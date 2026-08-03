import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { SUPPORT_EMAIL } from '../../lib/support.js';
import { useTrustpilot } from '../../lib/useTrustpilot.js';
import SellerIdentity from './SellerIdentity.jsx';

/** Real system status from /api/health (no fake claims). */
export function SystemStatus() {
  const { t } = useI18n();
  const [ok, setOk] = useState(null);   // null = loading → show nothing
  useEffect(() => {
    let live = true;
    fetch(`${api.base}/api/health`).then((r) => { if (live) setOk(r.ok); }).catch(() => { if (live) setOk(false); });
    return () => { live = false; };
  }, []);
  if (ok === null) return null;
  return ok
    ? <span className="text-emerald-700">{t('status.ok', '● All systems operational')}</span>
    : <span className="text-amber-700">{t('status.degraded', '● Partial degradation — orders may be delayed')}</span>;
}

/** Shared light storefront footer. */
export default function StoreFooter() {
  const trustpilot = useTrustpilot();
  const { t } = useI18n();
  const COLS = [
    { title: t('footer.shop', 'Shop'), links: [
      [t('footer.allProducts', 'All Products'), '/shop'],
      [t('footer.wishlist', 'Wishlist'), '/wishlist'],
      [t('footer.track', 'Track Order'), '/track'],
      [t('footer.payments', 'Payment Methods'), '/payment-methods']] },
    { title: t('footer.company', 'Company'), links: [
      [t('footer.about', 'About Us'), '/about'],
      [t('footer.how', 'How it works'), '/how-it-works'],
      [t('footer.trust', 'Trust Center'), '/trust'],
      [t('footer.reviews', 'Reviews'), '/reviews'],
      [t('footer.contact', 'Contact'), '/contact']] },
    { title: t('footer.help', 'Help & Legal'), links: [
      [t('footer.faq', 'FAQ'), '/faq'],
      [t('footer.refunds', 'Refund Policy'), '/refunds'],
      [t('footer.terms', 'Terms'), '/terms'],
      [t('footer.privacy', 'Privacy'), '/privacy'],
      [t('footer.cookies', 'Cookies'), '/cookies']] },
  ];
  return (
    <footer className="border-t border-slate-200/70 bg-white mt-12">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <Link to="/" className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <Zap size={18} fill="white" />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900">ForgeMarket</span>
          </Link>
          <p className="text-slate-500 text-sm mt-4 leading-relaxed">
            {t('footer.tagline', 'The marketplace for digital goods — fair prices, real support, every order tracked.')}
          </p>
          <Link to="/discord" className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-violet-600 hover:text-violet-700">
            {t('footer.discord', '💬 ForgeMarket Support on Discord')}
          </Link>
          {/* The footer is where a hesitant buyer looks for proof a human is
              behind this. Discord alone reads as "gamers only"; an address on
              the shop's own domain reads as a business. Renders only when set,
              so it never advertises a route that goes nowhere. */}
          {SUPPORT_EMAIL && (
            <a href={`mailto:${SUPPORT_EMAIL}`}
              className="block mt-2 text-sm text-slate-500 hover:text-violet-600 transition">
              ✉️ {SUPPORT_EMAIL}
            </a>
          )}
          {/* Renders only once TRUSTPILOT_URL is set on the server. A shop with
              no profile shows nothing here rather than a link that 404s — and a
              buyer who checks reviews and lands on an error trusts you less
              than one who never saw a link at all. */}
          {trustpilot && (
            <a href={trustpilot} target="_blank" rel="noreferrer"
              className="block mt-2 text-sm text-slate-500 hover:text-emerald-600 transition">
              ⭐ {t('footer.trustpilot', 'Read our Trustpilot reviews')}
            </a>
          )}
          {/* Who is selling, in the place every shopper has been trained to look
              for it. Dutch and EU law require this to be stated before someone
              buys; a footer that names nobody is the single most common thing a
              scam storefront and a real one look different on. */}
          <div className="mt-5 pt-4 border-t border-slate-200/70">
            <SellerIdentity compact />
          </div>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <div className="text-[12px] font-bold tracking-wider text-slate-400 uppercase mb-3">{c.title}</div>
            <ul className="space-y-2">
              {c.links.map(([label, to]) => (
                <li key={label}><Link to={to} className="text-[14px] text-slate-600 hover:text-violet-600">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200/70">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>© {new Date().getFullYear()} ForgeMarket · {t('footer.rights', 'Digital goods for gamers')}</span>
          <SystemStatus />
        </div>
      </div>
    </footer>
  );
}
