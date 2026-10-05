import { useConfig } from '../../lib/useConfig.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * How a buyer can pay, as recognisable marks rather than coloured dots.
 *
 * These are the providers' NAMES set in their own colours — not their logo
 * files, which the shop does not have a licence copy of. Inline styles on
 * purpose: the stylesheet has a size budget, and these are a handful of rules.
 */
const WORDMARK = {
  paypal: () => (<span style={{ fontStyle: 'italic', fontWeight: 800, letterSpacing: '-0.02em' }}>
    <span style={{ color: '#003087' }}>Pay</span><span style={{ color: '#009cde' }}>Pal</span></span>),
  revolut: () => <span style={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>Revolut</span>,
  tikkie: () => <span style={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>Tikkie</span>,
  ideal: () => <span style={{ fontWeight: 800, color: '#cc0066' }}>iDEAL</span>,
  bancontact: () => <span style={{ fontWeight: 800, color: '#005498' }}>Bancontact</span>,
  creditcard: () => <span style={{ fontWeight: 700, color: '#0f172a' }}>Card</span>,
  applepay: () => <span style={{ fontWeight: 700, color: '#0f172a' }}> Pay</span>,
};

export function PayMark({ id, label, size = 'md' }) {
  const Mark = WORDMARK[id];
  const h = size === 'sm' ? 26 : 32;
  return (
    <span title={label || id} style={{ height: h, padding: size === 'sm' ? '0 8px' : '0 11px', fontSize: size === 'sm' ? 12 : 14,
      display: 'inline-flex', alignItems: 'center', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0',
      boxShadow: '0 1px 2px rgba(15,23,42,.06)', whiteSpace: 'nowrap' }}>
      {Mark ? <Mark /> : <span style={{ fontWeight: 700, color: '#0f172a' }}>{label || id}</span>}
    </span>
  );
}

/** The methods this shop actually takes, from its config — never a guess. */
export function usePayMarks() {
  const c = useConfig();
  const out = [];
  if (c.paymentProvider === 'stripe') out.push({ id: 'ideal', label: 'iDEAL' }, { id: 'creditcard', label: 'Card' });
  for (const m of c.mollieMethods || []) out.push({ id: String(m.id || m).toLowerCase(), label: m.description || m.label || String(m.id || m) });
  for (const m of c.paymentMethods || []) out.push({ id: m.id, label: m.label });
  const seen = new Set();
  return out.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
}

/** "Pay with  [Tikkie] [PayPal] [Revolut]" — a row for under a buy button. */
export default function PaymentBadges({ className = '', size = 'sm' }) {
  const { t } = useI18n();
  const marks = usePayMarks();
  if (!marks.length) return null;
  return (
    <div className={className} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }} data-testid="payment-badges">
      <span style={{ fontSize: 12, color: '#64748b', marginRight: 2 }}>{t('pay.with', 'Pay with')}</span>
      {marks.map((m) => <PayMark key={m.id} id={m.id} label={m.label} size={size} />)}
    </div>
  );
}
