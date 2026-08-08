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
  // Same trap as below: res.json() throws on a non-JSON 200, and this one runs
  // on the FIRST request of every session. An unparseable body here would break
  // the whole app before any page had a chance to render its own error.
  const tok = parseJson(await res.text().catch(() => ''))?.accessToken;
  // The endpoint now answers 200 with a null token when there is no session, so
  // an anonymous visit is not a failed request. Guard against writing that null
  // over a token another tab may have just set.
  if (!tok) return false;
  setAccessToken(tok);
  return true;
}

// Default 30s: serverless cold-starts + a sleeping Neon database waking up can
// take 10-20s on the very first request, which would otherwise time out.
async function request(path, { method = 'GET', body, raw = false, retry = true, timeout = 30000, _coldRetry = true } = {}) {
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
    // First request woke a cold serverless function / sleeping DB — retry once,
    // by which point it's warm and responds quickly.
    //
    // GET only, and deliberately so. An AbortError means THIS SIDE gave up after
    // the timeout, not that the server ignored us: a slow POST /api/orders may
    // well have committed already, and retrying it would hand the buyer a second
    // order number and a second payment reminder for one purchase. Re-fetching a
    // GET costs nothing; re-sending a write costs an order.
    if (e.name === 'AbortError' && _coldRetry && method === 'GET') {
      return request(path, { method, body, raw, retry, timeout, _coldRetry: false });
    }
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
  const data = parseJson(text);

  // The body was there but it was not JSON. Something in front of the API
  // answered instead of the API: Vercel returns the plain text "A server error
  // has occurred" when a function crashes on boot, a CDN or WAF returns an HTML
  // block page, a proxy returns a gateway error. Parsing that used to throw
  // `SyntaxError: Unexpected identifier "A"` straight into the UI — a message
  // that tells the buyer nothing and points the owner at the wrong layer.
  if (text && data === UNPARSEABLE) {
    const err = new Error(res.ok
      ? 'The server sent an unexpected response. Please try again.'
      : 'The server is having trouble right now. Please try again in a moment.');
    err.status = res.status;
    // Kept off the message on purpose — the buyer gets a sentence, the console
    // gets the evidence needed to find which layer answered.
    err.body = text.slice(0, 500);
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status; err.details = data?.error?.details;
    throw err;
  }
  return data;
}

/** Sentinel: distinguishes "not JSON" from a body that legitimately parsed to null. */
const UNPARSEABLE = Symbol('unparseable');
function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return UNPARSEABLE; }
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
