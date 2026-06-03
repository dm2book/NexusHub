import InfoShell, { Prose } from '../../components/InfoShell.jsx';

const TERMS = (
  <Prose>
    <p>These terms govern your use of ForgeMarket. By placing an order you agree to them. This is a template — replace it with your own legal copy before going live.</p>
    <h2>1. Accounts</h2>
    <p>You are responsible for activity under your account. We use passwordless sign-in; keep access to your email secure.</p>
    <h2>2. Orders & delivery</h2>
    <p>Digital goods are delivered to your dashboard. Delivery times are typically instant but may vary by supplier availability.</p>
    <h2>3. Pricing</h2>
    <p>Prices are shown at checkout in the listed currency and may change at any time before an order is placed.</p>
    <h2>4. Refunds</h2>
    <p>Refunds are handled per our refund flow. Request one from your order page; approved refunds are returned to the original method.</p>
    <h2>5. Acceptable use</h2>
    <ul>
      <li>No fraudulent, abusive or automated misuse of the service.</li>
      <li>No reselling without authorisation.</li>
    </ul>
    <h2>6. Liability</h2>
    <p>The service is provided “as is”. To the extent permitted by law, our liability is limited to the value of the order in question.</p>
  </Prose>
);

const PRIVACY = (
  <Prose>
    <p>This policy explains what we collect and why. This is a template — replace it with your own policy and a real contact address before going live.</p>
    <h2>Data we collect</h2>
    <ul>
      <li>Account: email, display name, and login sessions.</li>
      <li>Orders: items, amounts, billing details you provide, and status history.</li>
      <li>Security: IP and user-agent for fraud prevention and audit logs.</li>
    </ul>
    <h2>How we use it</h2>
    <p>To fulfil orders, deliver goods, provide support, prevent fraud, and improve the service.</p>
    <h2>Sharing</h2>
    <p>We share order data with suppliers only as needed to fulfil your purchase, and with payment/email providers you’ve configured.</p>
    <h2>Your rights</h2>
    <p>You can access, export or delete your data by contacting support. Sessions can be revoked by signing out.</p>
    <h2>Retention</h2>
    <p>We keep order and audit records as required for accounting, security and legal obligations.</p>
  </Prose>
);

export default function Legal({ kind }) {
  const isTerms = kind === 'terms';
  return (
    <InfoShell eyebrow="Legal" title={isTerms ? 'Terms of Service' : 'Privacy Policy'}
      subtitle={`Last updated ${new Date().toLocaleDateString()}`}>
      {isTerms ? TERMS : PRIVACY}
    </InfoShell>
  );
}
