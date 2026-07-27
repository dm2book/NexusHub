import InfoShell, { Prose } from '../../components/InfoShell.jsx';
import { usePageMeta } from '../../lib/useMeta.js';
import { useI18n } from '../../lib/i18n.jsx';
import { SUPPORT_EMAIL } from '../../lib/support.js';
import { LEGAL, legalComplete, legalAddressLine } from '../../lib/legalIdentity.js';

/**
 * Terms and privacy, in both languages.
 *
 * A Dutch shop selling to Dutch consumers has to state its terms in a language
 * the buyer actually understands, so these are not left in English when the
 * site is switched.
 *
 * These describe how this shop ACTUALLY works — bank transfer with the order
 * number as the reference, payments confirmed by hand, in-stock items released
 * automatically and everything else delivered by hand. Terms that describe a
 * different shop are worse than none: they are a promise the owner cannot keep,
 * in the one document where promises are binding.
 *
 * Two things are deliberately visible rather than hidden:
 *  - Until the seller's legal name and address are filled in (legalIdentity.js),
 *    a notice says the identity details are still missing. Dutch law requires
 *    them; pretending otherwise on a page about legal compliance would be the
 *    worst possible place to bluff.
 *  - While there is no KvK registration, the page says ForgeMarket is run by a
 *    private individual. Implying a registered company that does not exist is
 *    the one claim here that could genuinely cause trouble.
 */

const IdentityBlock = ({ t }) => (
  <>
    <h2>{t('legal.whoH', 'Who you are dealing with')}</h2>
    {legalComplete() ? (
      <p>
        <b>{LEGAL.tradeName}</b>{LEGAL.legalName ? ` — ${LEGAL.legalName}` : ''}<br />
        {legalAddressLine()}<br />
        {SUPPORT_EMAIL && <>{t('legal.whoEmail', 'Email')}: {SUPPORT_EMAIL}<br /></>}
        {LEGAL.kvk
          ? <>{t('legal.whoKvk', 'Chamber of Commerce (KvK)')}: {LEGAL.kvk}<br /></>
          : <>{t('legal.whoNoKvk', 'ForgeMarket is currently run by a private individual and is not registered with the Chamber of Commerce.')}<br /></>}
        {LEGAL.vat && <>{t('legal.whoVat', 'VAT number')}: {LEGAL.vat}</>}
      </p>
    ) : (
      <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
        {t('legal.whoMissing', 'The seller’s full name and address are not published here yet. Dutch law requires them before selling to consumers — if you are reading this and they are still missing, ask us for them before you order.')}
        {SUPPORT_EMAIL && <> {t('legal.whoReach', 'You can reach us at')} {SUPPORT_EMAIL}.</>}
      </p>
    )}
  </>
);

const terms = (t) => (
  <Prose>
    <p>{t('legal.tIntro', 'These terms apply to every order placed on ForgeMarket. By placing an order you accept them. They are written to describe how this shop really works — read section 3 and 5 in particular, because manual payment and digital delivery work differently from a normal webshop.')}</p>

    <IdentityBlock t={t} />

    <h2>{t('legal.t1h', '1. Who may order')}</h2>
    <p>{t('legal.t1', 'You may order if you are 18 or older. If you are under 18 you may only order with the permission of a parent or guardian, and they are responsible for the purchase. We may cancel and refund an order if we have reason to believe this condition is not met.')}</p>
    <p>{t('legal.t1b', 'You do not need an account. If you create one, sign-in is passwordless and works through your email, so keep access to your inbox secure — anyone who can read your email can sign in as you.')}</p>

    <h2>{t('legal.t2h', '2. Prices')}</h2>
    <p>{t('legal.t2', 'All prices are in euros and include VAT where applicable. The price shown at the moment you place your order is the price that applies. Prices can change at any time before that moment. We do not add fees at checkout: the amount you are asked to pay is the amount shown.')}</p>
    <p>{t('legal.t2b', 'Obvious errors — a price that is clearly wrong, for example through a typing or system mistake — do not bind us. If that happens we will tell you before delivering and refund you in full if you no longer want the order.')}</p>

    <h2>{t('legal.t3h', '3. Payment')}</h2>
    <p>{t('legal.t3', 'You place your order first and then pay the amount shown, using your order number as the payment reference. That reference is how we link your payment to your order; without it we have to find it by hand, which delays your delivery.')}</p>
    <p>{t('legal.t3b', 'Payments are confirmed manually, usually within minutes during the day. An order that is not paid is cancelled automatically after the period stated on your order page, and nothing is charged to you.')}</p>

    <h2>{t('legal.t4h', '4. Delivery')}</h2>
    <p>{t('legal.t4', 'Items we hold in stock are released automatically as soon as your payment is confirmed. Everything else is bought in and delivered by hand, usually within a few hours during the day. Delivery goes to the email address on your order, and to your account dashboard if you have one.')}</p>
    <p>{t('legal.t4b', 'For top-ups that go straight onto a game account, you supply the account name at checkout. You are responsible for its accuracy: a top-up delivered to a name you gave us incorrectly cannot be reversed.')}</p>

    <h2>{t('legal.t5h', '5. Right of withdrawal (and when it does not apply)')}</h2>
    <p>{t('legal.t5', 'For most online purchases in the EU you have 14 days to change your mind. Digital content is the exception: once it has been delivered, that right ends — a code cannot be handed back.')}</p>
    <p>{t('legal.t5b', 'That is why checkout asks you to tick a box confirming two things: that you want your order delivered straight away, and that you understand you lose your 14-day right of withdrawal once it has been delivered. You cannot order without ticking it. If you have NOT yet received your order, you can still cancel it and get your money back.')}</p>

    <h2>{t('legal.t6h', '6. If something goes wrong')}</h2>
    <p>{t('legal.t6', 'If we cannot deliver your order, you get your money back in full — that is the guarantee, and it has no conditions attached. If a code does not work, tell us and we will replace it or refund you.')}</p>
    <p>{t('legal.t6b', 'Refunds are returned to the account you paid from, normally within a few working days. Report a problem by replying to your order email, from your order status page, or on our Discord.')}</p>

    <h2>{t('legal.t7h', '7. What you may not do')}</h2>
    <ul>
      <li>{t('legal.t7a', 'Pay with money or an account that is not yours, or reverse a payment after receiving your order.')}</li>
      <li>{t('legal.t7b', 'Automate ordering, or attempt to disrupt or gain unauthorised access to the shop.')}</li>
      <li>{t('legal.t7c', 'Resell what you buy here commercially without our written agreement.')}</li>
    </ul>
    <p>{t('legal.t7d', 'We may refuse or cancel an order, and close an account, where any of these happen. Legitimate orders are always refunded.')}</p>

    <h2>{t('legal.t8h', '8. Third-party services')}</h2>
    <p>{t('legal.t8', 'The goods sold here are used inside services run by other companies — game publishers and platforms. We are not affiliated with them and do not control their rules. If a platform blocks or removes a balance for reasons on their side, that is between you and them; if the problem is that our code never worked, that is ours and you get your money back.')}</p>

    <h2>{t('legal.t9h', '9. Liability')}</h2>
    <p>{t('legal.t9', 'We are liable for delivering what you paid for. Beyond that, and to the extent the law allows, our liability for any order is limited to the amount you paid for it. Nothing here limits rights you have as a consumer that cannot be limited by agreement.')}</p>

    <h2>{t('legal.t10h', '10. Law and complaints')}</h2>
    <p>{t('legal.t10', 'Dutch law applies. If we cannot resolve a complaint together, you can bring it to the European Commission’s online dispute resolution platform at ec.europa.eu/odr. You always keep the right to go to a competent court.')}</p>
    <p>{t('legal.t10b', 'We may update these terms. The version that applies to your order is the one published when you placed it.')}</p>
  </Prose>
);

const privacy = (t) => (
  <Prose>
    <p>{t('legal.pIntro', 'This policy explains what personal data ForgeMarket collects, why, who else sees it, and what you can do about it. It reflects how the shop actually works — we do not sell your data, and we do not track you across other websites.')}</p>

    <IdentityBlock t={t} />

    <h2>{t('legal.p1h', 'What we collect')}</h2>
    <ul>
      <li>{t('legal.p1a', 'Your email address — needed to sign in, to send your order confirmation, and to deliver your code.')}</li>
      <li>{t('legal.p1b', 'Your order: what you bought, the amount, the status history, and any game account name you supplied for a top-up.')}</li>
      <li>{t('legal.p1c', 'A display name and, only if you choose to add one, a phone number.')}</li>
      <li>{t('legal.p1d', 'Technical data: your IP address and browser, recorded with logins and orders. It is what stops someone hammering the login with a thousand email addresses, and what tells us a sign-in came from somewhere unfamiliar. We do not use it to build a profile of you, and it is erased on the schedule below.')}</li>
      <li>{t('legal.p1e', 'If you link your Discord account: your Discord user ID and username, so you can be given the right role.')}</li>
      <li>{t('legal.p1f', 'If you upload a payment screenshot: that image, until your payment is confirmed.')}</li>
    </ul>
    <p>{t('legal.p1g', 'We do not collect your bank details. You pay from your own banking app, so we only ever see that a payment arrived with your order number as the reference.')}</p>

    <h2>{t('legal.p2h', 'Why we are allowed to use it')}</h2>
    <ul>
      <li>{t('legal.p2a', 'To carry out the order you placed — this is a contract with you, and without this data we cannot deliver.')}</li>
      <li>{t('legal.p2b', 'To prevent fraud and abuse, and to keep the shop secure — our legitimate interest, and yours.')}</li>
      <li>{t('legal.p2c', 'To meet legal obligations, in particular keeping order records for tax purposes.')}</li>
      <li>{t('legal.p2d', 'For anything optional, such as marketing emails, only with your consent — which you can withdraw at any time.')}</li>
    </ul>

    <h2>{t('legal.p3h', 'Who else processes it')}</h2>
    <p>{t('legal.p3', 'We use a small number of service providers, who process data only on our instructions:')}</p>
    <ul>
      <li>{t('legal.p3a', 'Vercel — hosting for the website and the API.')}</li>
      <li>{t('legal.p3b', 'Neon — the database where your account and orders are stored.')}</li>
      <li>{t('legal.p3c', 'Resend — sending your login codes and order emails.')}</li>
      <li>{t('legal.p3d', 'Discord — only if you contact us there or link your account.')}</li>
    </ul>
    <p>{t('legal.p3e', 'Some of these are based outside the EU. Where that is the case, transfers rely on the European Commission’s standard contractual clauses. We do not sell your data, and we do not share it for advertising.')}</p>

    <h2>{t('legal.p4h', 'How long we keep it')}</h2>
    <ul>
      <li>{t('legal.p4a', 'Order and payment records: seven years, because Dutch tax law requires it.')}</li>
      <li>{t('legal.p4e', 'IP addresses: erased once they have done their job — after 7 days for login codes, 90 days for sign-in history, and at most a year where they are evidence attached to a payment. The record itself stays; the address is removed from it.')}</li>
      <li>{t('legal.p4b', 'Login codes: deleted automatically shortly after they expire or are used.')}</li>
      <li>{t('legal.p4c', 'Sessions: until they expire or you sign out; you can revoke them yourself in your account.')}</li>
      <li>{t('legal.p4d', 'Payment screenshots: removed once your payment has been confirmed.')}</li>
    </ul>

    <h2>{t('legal.p5h', 'Cookies and what we store in your browser')}</h2>
    <p>{t('legal.p5', 'We use one cookie to keep you signed in. Your cart, your language choice and your wishlist are kept in your own browser and never leave it until you place an order. We use no advertising or cross-site tracking cookies, which is why this site has no cookie banner asking for consent.')}</p>

    <h2>{t('legal.p6h', 'Your rights')}</h2>
    <p>{t('legal.p6', 'You can ask us for a copy of your data, to correct it, to delete it, to export it, or to object to how we use it. Email us and we will respond within a month. Deletion may be limited where we are legally required to keep order records.')}</p>
    <p>{t('legal.p6b', 'If you are unhappy with how we handle your data you can complain to the Dutch data protection authority, the Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl).')}</p>

    <h2>{t('legal.p7h', 'Children')}</h2>
    <p>{t('legal.p7', 'This shop is not intended for children under 16. If you believe a child has given us personal data, contact us and we will delete it.')}</p>

    <h2>{t('legal.p8h', 'Security')}</h2>
    <p>{t('legal.p8', 'Sign-in is passwordless, so there is no password of yours for us to lose. Traffic is encrypted, sessions use short-lived tokens, and access to the admin side requires a second factor. No system is perfect: if a breach ever affects your data, we will tell you.')}</p>
  </Prose>
);

export default function Legal({ kind }) {
  const { t } = useI18n();
  const isTerms = kind === 'terms';
  usePageMeta(
    isTerms ? 'Terms of Service' : 'Privacy Policy',
    isTerms
      ? 'The terms that apply to every ForgeMarket order: payment by reference, delivery, refunds and your right of withdrawal.'
      : 'What personal data ForgeMarket collects, why, who processes it, how long it is kept, and your rights.');
  return (
    <InfoShell eyebrow={t('legal.eyebrow', 'Legal')}
      title={isTerms ? t('legal.terms', 'Terms of Service') : t('legal.privacy', 'Privacy Policy')}
      subtitle={`${t('legal.updated', 'Last updated')} ${new Date().toLocaleDateString()}`}>
      {isTerms ? terms(t) : privacy(t)}
    </InfoShell>
  );
}
