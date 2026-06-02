/** Money helpers. Amounts are integer minor units (cents). */

export function formatMoney(minor, currency = 'EUR') {
  const major = (Number(minor || 0) / 100);
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}
