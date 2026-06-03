import { config } from './config.js';

/** Thin API client the bot uses to fetch data on behalf of the owner. */
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/v1${path}`, {
      headers: config.serviceToken ? { Authorization: `Bearer ${config.serviceToken}` } : {},
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: T };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

export const api = {
  portfolioSummary: () => get<any>('/portfolio/summary'),
  positions: () => get<any[]>('/portfolio/positions?status=OPEN'),
  watchlist: () => get<Record<string, any[]>>('/watchlist'),
  alerts: () => get<any[]>('/alerts'),
  discovery: () => get<any[]>('/discovery?limit=10'),
  whales: () => get<any[]>('/whales?limit=10'),
  opportunities: () => get<any[]>('/discovery?limit=10'),
  generateReport: async (type: string) => {
    const res = await fetch(`${config.apiBaseUrl}/api/v1/ai/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.serviceToken ? { Authorization: `Bearer ${config.serviceToken}` } : {}),
      },
      body: JSON.stringify({ type }),
    });
    if (!res.ok) return null;
    return (await res.json()).data;
  },
};
