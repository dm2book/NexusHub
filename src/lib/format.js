export const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

export const date = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
export const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
