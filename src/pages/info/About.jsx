import { Link } from 'react-router-dom';
import { Zap, ShieldCheck, MessageCircle, Receipt } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import SellerIdentity from '../../components/store/SellerIdentity.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';

/**
 * The page someone opens when they are deciding whether this shop is real.
 *
 * The previous copy claimed automated fulfilment "in seconds", "24/7 support"
 * and "a multi-supplier engine that sources resiliently across providers" — for
 * a shop run by one person who confirms every payment by hand. None of it was
 * true, and none of it answered the only question this page is actually asked:
 * who am I sending money to, and what happens if it goes wrong.
 *
 * What is here now is all verifiable by the reader on the day they read it.
 */
const FACTS = (t) => [
  {
    icon: Zap,
    title: t('about.fDeliveryT', 'How your order is delivered'),
    text: t('about.fDelivery', 'If the code is already in stock it is sent automatically the moment your payment is confirmed. Everything else is bought in and delivered by hand — normally within a few hours during the day, and first thing in the morning if you order late at night. The product page tells you which of the two applies before you buy.'),
  },
  {
    icon: Receipt,
    title: t('about.fPayT', 'How you pay'),
    text: t('about.fPay', 'You place the order first and then pay the exact amount shown, using your order number as the reference. Payments are matched by a person, not a machine, so confirmation is fastest during the day. Nothing is charged automatically and no card details are stored on this site.'),
  },
  {
    icon: ShieldCheck,
    title: t('about.fWrongT', 'If something goes wrong'),
    text: t('about.fWrong', 'If an order cannot be delivered you get your money back in full — that is the guarantee, not a goodwill gesture. Until your order is delivered you can still cancel it by replying to your order email. The full terms are on the refund page.'),
  },
  {
    icon: MessageCircle,
    title: t('about.fReachT', 'Reaching a human'),
    text: t('about.fReach', 'Every ticket and every email is answered by the person who runs the shop. That means honest hours rather than a call centre: fast during the day, and the next morning if you write at night.'),
  },
];

export default function About() {
  usePageMeta('About ForgeMarket',
    'Who runs ForgeMarket, how orders are really delivered, how you pay, and what happens if something goes wrong.');
  const { t } = useI18n();
  const facts = FACTS(t);

  return (
    <InfoShell
      eyebrow={t('about.eyebrow', 'About us')}
      title={t('about.title', 'A small shop, run properly')}
      subtitle={t('about.sub', 'ForgeMarket sells game top-ups and gift cards from the Netherlands. It is run by one person — which is why everything below says what actually happens rather than what sounds impressive.')}
      narrow={false}
    >
      <div className="mb-10">
        <SellerIdentity />
      </div>

      <div className="grid sm:grid-cols-2 gap-5 mb-12">
        {facts.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-6">
            <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center mb-4">
              <Icon size={20} className="text-primary" />
            </div>
            <h3 className="text-white mb-1.5">{title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      <div className="card p-8 text-center max-w-2xl mx-auto">
        <h2 className="text-2xl text-white">{t('about.ready', 'Still not sure?')}</h2>
        <p className="text-slate-400 mt-2 leading-relaxed">
          {t('about.readySub', 'Ask before you buy — on Discord you can also ask people who have already ordered. No account needed to browse or to check an order.')}
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-6">
          <Link to="/shop" className="btn-primary">{t('home.shopNow', 'Shop now')}</Link>
          <Link to="/discord" className="btn-ghost">{t('home.joinBtn', 'Join Discord')}</Link>
          <Link to="/refunds" className="btn-ghost">{t('footer.refunds', 'Refund Policy')}</Link>
        </div>
      </div>
    </InfoShell>
  );
}
