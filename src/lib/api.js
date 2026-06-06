/**
 * Thin API client. Holds the access token in memory, transparently refreshes it
 * via the httpOnly refresh-cookie session when a request 401s, and exposes a
 * small helper surface used across the app.
 */
// Default to same-origin (''), so the Vite dev proxy and same-domain prod
// deploys work with no config. Set VITE_API_URL for a separate API domain.
const API_BASE = import.meta.env.VITE_API_URL || '';

let accessToken = null;
const listeners = new Set();

export function setAccessToken(token) {
  accessToken = token;
  if (token) localStorage.setItem('fm_token', token);
  else localStorage.removeItem('fm_token');
  listeners.forEach((fn) => fn(token));
}
export function getAccessToken() {
  if (!accessToken) accessToken = localStorage.getItem('fm_token');
  return accessToken;
}
export function onTokenChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function refresh() {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST', credentials: 'include',
  });
  if (!res.ok) return false;
  const { accessToken: tok } = await res.json();
  setAccessToken(tok);
  return true;
}

async function request(path, { method = 'GET', body, raw = false, retry = true, timeout = 12000 } = {}) {
  const headers = {};
  const token = getAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  // Abort hung requests so the UI never spins forever (e.g. API/DB unreachable).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers, credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(e.name === 'AbortError'
      ? 'The server took too long to respond. Please try again.'
      : 'Network error. Please check your connection and try again.');
    err.status = 0;
    throw err;
  }
  clearTimeout(timer);

  if (res.status === 401 && retry && getAccessToken()) {
    if (await refresh()) return request(path, { method, body, raw, retry: false });
  }
  if (raw) return res;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status; err.details = data?.error?.details;
    throw err;
  }
  return data;
}

export const api = {
  base: API_BASE,
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  refresh,
};
