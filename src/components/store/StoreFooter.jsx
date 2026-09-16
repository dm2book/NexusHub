import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Zap, MessageCircle, Mail, Star, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { SUPPORT_EMAIL } from '../../lib/support.js';
import { CookiePreferencesLink } from '../CookieConsent.jsx';
import { useTrustpilot } from '../../lib/useTrustpilot.js';
import SellerIdentity from './SellerIdentity.jsx';

/**
 * Real system status from /api/health (no fake claims).
 *
 * Asked for only once this line is close to being read. It sits in the footer,
 * a screen or two below anything a visitor has looked at yet, and it used to
 * fire in the same breath as the requests that decide whether the page has any
 * content — measured on a product page: /api/health went out alongside the
 * product itself and finished 250ms after it, on a connection carrying both.
 * A status dot nobody has scrolled to is not worth a slot in that queue.
 */
export function SystemStatus() {
  const { t } = useI18n();
  const [ok, setOk] = useState(null);   // null = loading → show nothing
  const [seen, setSeen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    // No IntersectionObserver (or no element yet) → ask straight away rather
    // than never showing the status at all.
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return undefined;
    let live = true;
    fetch(`${api.base}/api/health`).then((r) => { if (live) setOk(r.ok); }).catch(() => { if (live) setOk(false); });
    return () => { live = false; };
  }, [seen]);
  if (ok === null) return <span ref={ref} aria-hidden="true" />;
  return ok
    ? <span className="text-emerald-700">{t('status.ok', '● All systems operational')}</span>
    : <span className="text-amber-700">{t('status.degraded', '● Partial degradation — orders may be delayed')}</span>;
}

/** Shared light storefront footer. */
export default function StoreFooter() {
  const trustpilot = useTrustpilot();
  const { t } = useI18n();
  const COLS = [
    // The landing pages get a column of their own. Not decoration: a page that
    // nothing links to is a page a crawler has to be told about twice, and this
    // is also where a visitor who lands on the FAQ finds what the shop sells.
    { title: t('footer.popular', 'Popular'), links: [
      ['Robux', '/robux'],
      ['V-Bucks', '/v-bucks'],
      ['Valorant Points', '/valorant-points'],
      [t('footer.giftcards', 'Giftcards'), '/giftcards'],
      [t('footer.gameCurrency', 'Game currency'), '/game-currency']] },
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
    /* The grid had FOUR columns and five things to put in them — the brand
       block plus four link columns — so "Help & Legal" wrapped underneath the
       brand and three quarters of the footer was empty white. On every page,
       and this is the last thing a hesitant buyer reads.
       Five tracks now, with the brand given the extra width it needs for the
       tagline, the two contact routes and the seller identity. Below `lg` it
       goes to two columns and the brand spans both, which keeps the identity
       block readable instead of squeezed into half a phone. */
    <footer className="border-t border-slate-200/70 bg-white mt-12">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-12
                      grid grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-x-6 gap-y-8 lg:gap-10">
        {/* Two columns even on a phone. Stacked one-up these four short lists
            ran to about 1,800px of footer, which is a lot of scrolling past on
            the way to the refund policy — the page people reach for when
            something has gone wrong. The brand block keeps the full width
            because the tagline and the two contact routes need it. */}
        <div className="col-span-2 lg:col-span-1">
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
          {/* Real icons, not emoji. Every other row of this site uses the
              lucide set, and three emoji in the one place a nervous buyer
              looks for proof of a human read as a different site — they render
              in the OS's own style, at the OS's own weight, next to type that
              was chosen. */}
          <Link to="/discord" className="group inline-flex items-center gap-2 mt-4 py-1 min-h-[24px] text-sm font-semibold text-violet-600 hover:text-violet-700">
            <MessageCircle size={15} className="shrink-0 transition-transform group-hover:-translate-y-px" />
            {t('footer.discordPlain', 'ForgeMarket Support on Discord')}
          </Link>
          {/* The footer is where a hesitant buyer looks for proof a human is
              behind this. Discord alone reads as "gamers only"; an address on
              the shop's own domain reads as a business. Renders only when set,
              so it never advertises a route that goes nowhere. */}
          {SUPPORT_EMAIL && (
            <a href={`mailto:${SUPPORT_EMAIL}`}
              className="flex items-center gap-2 py-1 min-h-[24px] mt-1.5 text-sm text-slate-500 hover:text-violet-600 transition">
              <Mail size={15} className="shrink-0" />
              {SUPPORT_EMAIL}
            </a>
          )}
          {/* Renders only once TRUSTPILOT_URL is set on the server. A shop with
              no profile shows nothing here rather than a link that 404s — and a
              buyer who checks reviews and lands on an error trusts you less
              than one who never saw a link at all. */}
          {trustpilot && (
            <a href={trustpilot} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 py-1 min-h-[24px] mt-1.5 text-sm text-slate-500 hover:text-emerald-600 transition">
              <Star size={15} className="shrink-0" />
              {t('footer.trustpilot', 'Read our Trustpilot reviews')}
            </a>
          )}
          {/* Who is selling, in the place every shopper has been trained to look
              for it. Dutch and EU law require this to be stated before someone
              buys; a footer that names nobody is the single most common thing a
              scam storefront and a real one look different on. */}
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <div className="text-[12px] font-bold tracking-wider text-slate-400 uppercase mb-3">{c.title}</div>
            {/* space-y-1 + inline-block padding, not space-y-2 on bare inline
                links: these rendered 17px tall, under the 24px WCAG 2.2 asks for
                a touch target. The footer is where the refund policy and the
                terms live — the pages a buyer reaches for when something has
                gone wrong, on a phone, in a hurry. */}
            <ul className="space-y-1">
              {c.links.map(([label, to]) => (
                <li key={label}><Link to={to} className="inline-block py-1 min-h-[24px] text-[14px] text-slate-600 hover:text-violet-600">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Across the whole footer rather than tucked into the brand column.
          This is the shop's answer to "who is actually taking my money", and a
          scam storefront's footer is the one place that cannot be copied — so
          it should not look like the thing the page would rather you skipped.
          It also fills the band the four short link columns leave behind,
          which is why the footer stopped looking half-finished. */}
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 pb-12">
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 px-5 py-4
                        flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-8">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider
                        text-slate-400 shrink-0 sm:pt-0.5">
            <ShieldCheck size={13} className="text-emerald-600" />
            {t('footer.whoSells', 'Who you are buying from')}
          </p>
          <div className="min-w-0 flex-1"><SellerIdentity compact /></div>
        </div>
      </div>

      <div className="border-t border-slate-200/70">
        {/* Room on the right for the chat launcher, which floats above this bar
            and was sitting on top of "All systems operational" — the one line
            here whose whole job is to be read. */}
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 pe-4 lg:pe-24 py-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>© {new Date().getFullYear()} ForgeMarket · {t('footer.rights', 'Digital goods for gamers')}</span>
          <div className="flex items-center gap-4">
            {/* Withdrawing consent has to be as easy as giving it, so it cannot
                live only in a banner that never returns once answered. */}
            <CookiePreferencesLink className="inline-block py-1 min-h-[24px] underline underline-offset-2 hover:text-violet-600 transition" />
            <SystemStatus />
          </div>
        </div>
      </div>
    </footer>
  );
}
