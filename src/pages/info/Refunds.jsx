import { Link } from 'react-router-dom';
import InfoShell, { Prose } from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';

export default function Refunds() {
  const { lang, t } = useI18n();
  const nl = lang === 'nl';
  return (
    <InfoShell eyebrow={nl ? 'Kopersbescherming' : 'Buyer protection'}
      title={nl ? 'Terugbetalings- & geld-terug-beleid' : 'Refund & money-back policy'}
      subtitle={nl ? 'Je aankoop is beschermd. Dit is precies wanneer en hoe we terugbetalen.'
        : "Your purchase is protected. Here's exactly when and how we refund."}>
      {nl ? (
        <Prose>
          <h2>Onze belofte</h2>
          <p>Elke in aanmerking komende bestelling valt onder onze geld-terug-garantie. Gaat er iets
          mis met een aankoop, dan lossen we het op — met een vervanging of een terugbetaling.</p>

          <h2>Wanneer je recht hebt op terugbetaling</h2>
          <ul>
            <li>Je code of top-up is <strong>niet geleverd</strong>.</li>
            <li>De code is <strong>ongeldig of al gebruikt</strong> bij ontvangst.</li>
            <li>Je bent <strong>afgeschreven maar de bestelling bleef onbetaald/geannuleerd</strong> aan onze kant.</li>
            <li>Een duidelijke prijs- of productfout van onze kant.</li>
          </ul>

          <h2>Wanneer terugbetaling meestal niet mogelijk is</h2>
          <ul>
            <li>Een code die <strong>al door jou is bekeken/gebruikt</strong> (en werkt zoals beschreven).</li>
            <li>Spijt na een geslaagde levering van een geldige code.</li>
            <li>Verkeerde regio/platform gekozen bij het afrekenen, tegen de productinformatie in.</li>
          </ul>

          <h2>Zo vraag je het aan</h2>
          <p>Open je bestelpagina en vraag een terugbetaling aan, of open een ticket in onze Discord
          met je bestelnummer. De meeste verzoeken beoordelen we binnen enkele uren tijdens openingstijden.</p>

          <h2>Hoe terugbetalingen worden uitbetaald</h2>
          <p>Goedgekeurde terugbetalingen gaan terug via je oorspronkelijke methode (Tikkie / Revolut /
          PayPal). PayPal Goederen &amp; Diensten-betalingen kunnen daarnaast via PayPals eigen
          kopersbescherming worden betwist.</p>
        </Prose>
      ) : (
        <Prose>
          <h2>Our promise</h2>
          <p>Every eligible order is backed by a money-back guarantee. If something goes wrong with
          a purchase, we make it right — a replacement or a refund.</p>

          <h2>When you're eligible for a refund</h2>
          <ul>
            <li>Your code or top-up was <strong>not delivered</strong>.</li>
            <li>The code is <strong>invalid or already used</strong> on arrival.</li>
            <li>You were <strong>charged but the order stayed unpaid/cancelled</strong> on our side.</li>
            <li>A clear pricing or listing error on our part.</li>
          </ul>

          <h2>When a refund usually isn't possible</h2>
          <ul>
            <li>A redeemable code that has <strong>already been revealed/used</strong> by you (working as described).</li>
            <li>Buyer's remorse after successful delivery of a valid code.</li>
            <li>Wrong region/platform chosen at checkout against the listing details.</li>
          </ul>

          <h2>How to request</h2>
          <p>Open your order page and request a refund, or open a ticket in our Discord with your
          order number. We review most requests within a few hours during open hours.</p>

          <h2>How refunds are paid</h2>
          <p>Approved refunds go back via your original method (Tikkie / Revolut / PayPal). PayPal
          Goods &amp; Services payments may also be disputed through PayPal's own buyer protection.</p>
        </Prose>
      )}
      <div className="mt-10 flex gap-3">
        <Link to="/track" className="btn-primary">{t('refunds.trackCta', 'Track / manage an order')}</Link>
        <Link to="/discord" className="btn-ghost">{t('refunds.ticketCta', 'Open a ticket')}</Link>
      </div>
    </InfoShell>
  );
}
