import { useI18n } from '../../lib/i18n.jsx';

/**
 * Money back, or store credit — the buyer's choice when asking for a refund.
 *
 * Used on the account order page (dark) and the public track page (light), so
 * colours come from the surrounding text rather than a theme: the title
 * inherits, the explanation is the same colour at lower opacity, and the
 * selected option is marked in the brand violet, which reads on both.
 *
 * Store credit needs an account (it lives in a wallet). On a guest order the
 * option is shown but disabled with the reason, rather than hidden — a buyer
 * who knows it exists can make an account next time.
 */
export default function RefundMethodChoice({ value, onChange, creditAllowed = true }) {
  const { t } = useI18n();
  const option = (key, title, body, disabled = false) => {
    const on = value === key;
    return (
      <label key={key} data-testid={`refund-method-${key}`}
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 12,
          border: `1px solid ${on ? 'rgba(139,92,246,.75)' : 'rgba(127,127,127,.3)'}`,
          background: on ? 'rgba(139,92,246,.12)' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        }}>
        <input type="radio" name="refund-method" value={key} checked={on} disabled={disabled}
          onChange={() => onChange(key)} style={{ marginTop: 3, accentColor: '#8b5cf6' }} />
        <span>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{title}</span>
          <span style={{ display: 'block', fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>{body}</span>
        </span>
      </label>
    );
  };
  return (
    <fieldset style={{ display: 'grid', gap: 8, margin: '0 0 12px', padding: 0, border: 0 }}>
      <legend style={{ fontSize: 14, marginBottom: 8, opacity: 0.85 }}>
        {t('refund.method.legend', 'How would you like it back?')}
      </legend>
      {option('money', t('refund.method.money', 'Money back'),
        t('refund.method.moneyBody', 'Back the way you paid. How soon you see it depends on your bank or payment service.'))}
      {option('credit', t('refund.method.credit', 'Store credit'),
        creditAllowed
          ? t('refund.method.creditBody', 'The full amount in your account as soon as we approve it — ready for your next order.')
          : t('refund.method.creditGuest', 'Only for orders placed with an account.'),
        !creditAllowed)}
    </fieldset>
  );
}
