export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const API_URL = `${API_BASE_URL}/api/v1`;

export const WS_URL = `${API_BASE_URL.replace(/^http/, 'ws')}/realtime`;

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
