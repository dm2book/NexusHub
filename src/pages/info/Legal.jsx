import InfoShell, { Prose } from '../../components/InfoShell.jsx';
import { usePageMeta } from '../../lib/useMeta.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Terms and privacy, in both languages.
 *
 * A Dutch shop selling to Dutch consumers has to state its terms in a language
 * the buyer actually understands, so these are not left in English when the
 * site is switched. The "still a template" warning is kept deliberately: it is
 * true, and hiding it would be worse than saying it.
 *
 * The old delivery clause promised delivery "typically instant" — the exact
 * claim the storefront, the emails and the Discord all stopped making, and the
 * one place where it would have been a contractual promise.
 */
const terms = (t) => (
  <Prose>
    <p>{t('legal.tIntro', 'These terms govern your use of ForgeMarket. By placing an order you agree to them. This is a template — replace it with your own legal copy before going live.')}</p>
    <h2>{t('legal.t1h', '1. Accounts')}</h2>
    <p>{t('legal.t1', 'You do not need an account to order. If you create one, sign-in is passwordless, so keep access to your email secure — anyone with your inbox can sign in.')}</p>
    <h2>{t('legal.t2h', '2. Orders & delivery')}</h2>
    <p>{t('legal.t2', 'Items we hold in stock are delivered automatically once your payment is confirmed. Everything else is bought in and delivered by hand, usually within a few hours during the day. Delivery goes to the email address on the order.')}</p>
    <h2>{t('legal.t3h', '3. Payment')}</h2>
    <p>{t('legal.t3', 'You place the order first and then pay the amount shown, using your order number as the payment reference. Payments are confirmed manually. An order is only reserved once, and is cancelled if payment never arrives.')}</p>
    <h2>{t('legal.t4h', '4. Pricing')}</h2>
    <p>{t('legal.t4', 'Prices are shown at checkout in the listed currency and may change at any time before an order is placed.')}</p>
    <h2>{t('legal.t5h', '5. Refunds')}</h2>
    <p>{t('legal.t5', 'If we cannot deliver your order, you get your money back. Request a refund from your order page or by replying to your order email; approved refunds are returned to the method you paid from.')}</p>
    <h2>{t('legal.t6h', '6. Acceptable use')}</h2>
    <ul>
      <li>{t('legal.t6a', 'No fraudulent, abusive or automated misuse of the service.')}</li>
      <li>{t('legal.t6b', 'No reselling without authorisation.')}</li>
    </ul>
    <h2>{t('legal.t7h', '7. Liability')}</h2>
    <p>{t('legal.t7', 'The service is provided “as is”. To the extent permitted by law, our liability is limited to the value of the order in question.')}</p>
  </Prose>
);

const privacy = (t) => (
  <Prose>
    <p>{t('legal.pIntro', 'This policy explains what we collect and why. This is a template — replace it with your own policy and a real contact address before going live.')}</p>
    <h2>{t('legal.p1h', 'Data we collect')}</h2>
    <ul>
      <li>{t('legal.p1a', 'Account: email, display name, and login sessions.')}</li>
      <li>{t('legal.p1b', 'Orders: items, amounts, billing details you provide, and status history.')}</li>
      <li>{t('legal.p1c', 'Security: IP address and browser for fraud prevention and audit logs.')}</li>
    </ul>
    <h2>{t('legal.p2h', 'How we use it')}</h2>
    <p>{t('legal.p2', 'To fulfil orders, deliver goods, provide support, prevent fraud, and improve the service.')}</p>
    <h2>{t('legal.p3h', 'Sharing')}</h2>
    <p>{t('legal.p3', 'We share order data with suppliers only as needed to fulfil your purchase, and with the payment and email providers we use.')}</p>
    <h2>{t('legal.p4h', 'Your rights')}</h2>
    <p>{t('legal.p4', 'You can access, export or delete your data by contacting support. Sessions can be revoked by signing out.')}</p>
    <h2>{t('legal.p5h', 'Retention')}</h2>
    <p>{t('legal.p5', 'We keep order and audit records as required for accounting, security and legal obligations.')}</p>
  </Prose>
);

export default function Legal({ kind }) {
  const { t } = useI18n();
  usePageMeta('Terms & privacy', 'The terms you agree to when ordering, and how your personal data is handled.');
  const isTerms = kind === 'terms';
  return (
    <InfoShell eyebrow={t('legal.eyebrow', 'Legal')}
      title={isTerms ? t('legal.terms', 'Terms of Service') : t('legal.privacy', 'Privacy Policy')}
      subtitle={`${t('legal.updated', 'Last updated')} ${new Date().toLocaleDateString()}`}>
      {isTerms ? terms(t) : privacy(t)}
    </InfoShell>
  );
}
