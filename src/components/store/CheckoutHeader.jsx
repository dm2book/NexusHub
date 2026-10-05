import { Link } from 'react-router-dom';
import { Zap, Lock, ArrowLeft } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * The header of the checkout: the brand, "secure checkout", and the one way
 * back — to the cart. No menu, no search, no account button: every one of those
 * was a door out of the step where the money is decided, and a buyer who wants
 * to keep shopping has the cart link.
 */
export function CheckoutHeader() {
  const { t } = useI18n();
  return (
    <header className="bg-white border-b border-slate-200/80">
      <div className="mx-auto px-4 lg:px-8 flex items-center gap-3" style={{ maxWidth: 1152, height: 60 }}>
        <Link to="/" aria-label="ForgeMarket" className="flex items-center gap-2 shrink-0">
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white"
            style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)', boxShadow: '0 4px 10px rgba(124,92,255,.3)' }}>
            <Zap size={16} fill="white" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-slate-900">ForgeMarket</span>
        </Link>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
          <Lock size={14} /> <span className="hidden sm:inline">{t('checkout.secure', 'Secure checkout')}</span>
        </span>
        <Link to="/cart" className="ml-auto flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-violet-700 transition">
          <ArrowLeft size={14} /> {t('checkout.backToCart', 'Back to cart')}
        </Link>
      </div>
    </header>
  );
}

/** The checkout's footer: only what the law and a worried buyer need. */
export function CheckoutFooter() {
  const { t } = useI18n();
  const links = [['/voorwaarden', t('footer.terms', 'Terms')], ['/privacybeleid', t('footer.privacy', 'Privacy')],
    ['/retourbeleid', t('footer.refunds', 'Refund policy')], ['/contact', t('footer.contact', 'Contact')]];
  return (
    <footer className="border-t border-slate-200/80 bg-white">
      <div className="mx-auto px-4 lg:px-8 py-4 flex flex-wrap items-center text-[12.5px] text-slate-500" style={{ maxWidth: 1152, columnGap: 16, rowGap: 4 }}>
        <span>© {new Date().getFullYear()} ForgeMarket</span>
        {links.map(([to, label]) => <Link key={to} to={to} className="hover:text-violet-700">{label}</Link>)}
        <a href="mailto:support@forgemarket.nl" className="hover:text-violet-700">support@forgemarket.nl</a>
      </div>
    </footer>
  );
}
