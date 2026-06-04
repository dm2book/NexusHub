// Empty/unset => same-origin (the all-on-Vercel deployment serves the API from
// the same Next.js app at /api/v1). Set NEXT_PUBLIC_API_BASE_URL to point at a
// separately-hosted API (e.g. Render/Railway).
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const API_URL = `${API_BASE_URL}/api/v1`;

// Realtime WebSockets only exist when a long-running API server is hosted
// separately. On serverless (Vercel) it's disabled and the UI uses polling.
export const REALTIME_ENABLED =
  process.env.NEXT_PUBLIC_REALTIME === '1' && API_BASE_URL.startsWith('http');

export const WS_URL = API_BASE_URL
  ? `${API_BASE_URL.replace(/^http/, 'ws')}/realtime`
  : '';

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
