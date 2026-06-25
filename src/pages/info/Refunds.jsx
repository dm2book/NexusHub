import { Link } from 'react-router-dom';
import InfoShell, { Prose } from '../../components/InfoShell.jsx';

export default function Refunds() {
  return (
    <InfoShell eyebrow="Buyer protection" title="Refund & money-back policy"
      subtitle="Your purchase is protected. Here's exactly when and how we refund.">
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
      <div className="mt-10 flex gap-3">
        <Link to="/track" className="btn-primary">Track / manage an order</Link>
        <Link to="/discord" className="btn-ghost">Open a ticket</Link>
      </div>
    </InfoShell>
  );
}
