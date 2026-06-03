export function usd(n: number | undefined | null, max = 2): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: max })}`;
}

export function price(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  if (v === 0) return '$0';
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  if (v < 1) return `$${v.toPrecision(3)}`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function pct(n: number | undefined | null, withSign = true): string {
  const v = Number(n ?? 0);
  const sign = withSign && v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export function compact(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export function timeAgo(iso: string | number | Date): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function duration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export const up = (n: number) => (Number(n) >= 0 ? 'text-up' : 'text-down');
