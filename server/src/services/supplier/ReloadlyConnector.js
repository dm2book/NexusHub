/**
 * ReloadlyConnector — official gift cards bought automatically via Reloadly.
 *
 * Reloadly is a wholesale distributor for digital gift cards (Steam, PSN,
 * Xbox, App Store, Roblox and the like), not a marketplace of other sellers'
 * keys. Sign-up is free, every account has a sandbox with a test wallet, and
 * the live API needs only a business (KYB) check on the same account.
 *
 * config (on the supplier row — all optional, Admin → Keys and connections is
 * the default source for the credentials):
 *   { clientId?, clientSecret?, sandbox?: true|false, countryCode?: "NL", autoDeliver?: true }
 *
 * SKU: `<reloadly productId>:<denomination>` — the denomination in the card's
 * own (recipient) currency, e.g. "15077:25" for a €25 card. One Reloadly
 * product carries several denominations, and the denomination is what is
 * bought, so it is part of what is mapped.
 *
 * Flow (the platform's async fulfilment model, as with Kinguin):
 *   createFulfillment → POST /orders (customIdentifier = our order item id)
 *                       SUCCESSFUL → GET cards → delivered
 *                       otherwise  → in_progress with the transaction id
 *   checkFulfillment  → GET cards; none yet → ask the transaction's status
 *
 * Every path and field name the Reloadly API uses is in RELOADLY below, so a
 * change on their side is one edit here.
 */
import { SupplierConnector } from './SupplierConnector.js';
import { supplierFetch } from './supplierHttp.js';
import { config as appConfig } from '../../config/env.js';

export const RELOADLY = Object.freeze({
  authUrl: 'https://auth.reloadly.com/oauth/token',
  live: 'https://giftcards.reloadly.com',
  sandbox: 'https://giftcards-sandbox.reloadly.com',
  accept: 'application/com.reloadly.giftcards-v1+json',
  paths: {
    balance: '/accounts/balance',
    products: '/products',
    product: (id) => `/products/${encodeURIComponent(id)}`,
    order: '/orders',
    cards: (tx) => `/orders/transactions/${encodeURIComponent(tx)}/cards`,
    transaction: (tx) => `/reports/transactions/${encodeURIComponent(tx)}`,
  },
  done: ['SUCCESSFUL', 'COMPLETED'],
  failed: ['FAILED', 'REFUNDED', 'CANCELLED', 'CANCELED', 'DECLINED'],
});

const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const falsy = (v) => /^(0|false|no|off)$/i.test(String(v ?? '').trim());

/* One token per account and audience, kept until shortly before it expires.
   Reloadly's tokens live for hours; asking for one per request would be a
   second round trip on every purchase and a rate limit waiting to happen. */
const tokens = new Map();
export function clearReloadlyTokens() { tokens.clear(); }

/** "15077:25" → { productId: 15077, amount: 25 }; null when it is not that shape. */
export function parseSku(sku) {
  const m = /^\s*(\d+)\s*:\s*(\d+(?:\.\d{1,2})?)\s*$/.exec(String(sku ?? ''));
  return m ? { productId: Number(m[1]), amount: Number(m[2]) } : null;
}

/** Is the shop open — the same reading as the launch gate. */
function launched() {
  const at = appConfig.launch?.date;
  if (!at) return true;
  const t = new Date(at).getTime();
  return !Number.isFinite(t) || Date.now() >= t;
}

export class ReloadlyConnector extends SupplierConnector {
  static kind = 'reloadly';

  /* The row's own values win; Admin → Keys and connections (or the env) is the
     default, so the owner can paste the keys once and add a supplier without
     writing JSON. */
  get #shared() { return appConfig.suppliers?.reloadly || {}; }
  get #clientId() { return String(this.config.clientId || this.#shared.clientId || '').trim(); }
  get #clientSecret() { return String(this.config.clientSecret || this.#shared.clientSecret || '').trim(); }
  get #configured() { return !!(this.#clientId && this.#clientSecret); }

  /** Sandbox unless somebody said otherwise — sandbox codes are not real cards. */
  get sandbox() {
    if (typeof this.config.sandbox === 'boolean') return this.config.sandbox;
    if (this.config.sandbox != null && String(this.config.sandbox).trim() !== '') return !falsy(this.config.sandbox);
    const shared = this.#shared.sandbox;
    return !(shared != null && falsy(shared));
  }

  get #base() { return this.sandbox ? RELOADLY.sandbox : RELOADLY.live; }
  get #country() { return String(this.config.countryCode || 'NL').toUpperCase(); }

  get supportsSync() { return false; } // the catalogue is searched, not mirrored
  get supportsSearch() { return this.#configured; }
  get supportsFulfillment() { return this.#configured && this.config.autoDeliver !== false; }

  async #token(deadline) {
    const key = `${this.#clientId}|${this.#base}`;
    const hit = tokens.get(key);
    if (hit && hit.until > Date.now()) return hit.token;
    const res = await supplierFetch(RELOADLY.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.#clientId, client_secret: this.#clientSecret,
        grant_type: 'client_credentials', audience: this.#base,
      }),
    }, { deadline, checkHost: false });
    const data = safeJson(await res.text());
    if (!res.ok || !data?.access_token) {
      throw Object.assign(new Error(`Reloadly login: ${data?.message || data?.error_description || data?.error || `HTTP ${res.status}`}`),
        { status: res.status || 401 });
    }
    // A minute early, so a token is never sent in its last seconds.
    const ttl = Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60_000;
    tokens.set(key, { token: data.access_token, until: Date.now() + ttl });
    return data.access_token;
  }

  async #request(path, { method = 'GET', body, deadline } = {}) {
    if (!this.#configured) throw Object.assign(new Error('Reloadly: no client id and secret configured'), { status: 400 });
    const token = await this.#token(deadline);
    const res = await supplierFetch(`${this.#base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: RELOADLY.accept,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }, { deadline, checkHost: false });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (res.status === 401) tokens.delete(`${this.#clientId}|${this.#base}`);
    if (!res.ok) {
      throw Object.assign(new Error(`Reloadly API: ${data?.message || data?.errorCode || `HTTP ${res.status}`}`),
        { status: res.status, errorCode: data?.errorCode || null });
    }
    return data;
  }

  async testConnection() {
    if (!this.#configured) {
      return { ok: false, detail: 'Add the Reloadly client id and secret (Admin → Keys and connections) to enable buying.' };
    }
    try {
      const b = await this.#request(RELOADLY.paths.balance);
      const mode = this.sandbox ? 'SANDBOX — test wallet, codes are not real' : 'LIVE';
      return { ok: true, detail: `Connected to Reloadly (${mode}). Balance: ${b?.balance ?? '?'} ${b?.currencyCode || ''}`.trim() };
    } catch (e) { return { ok: false, detail: e.message }; }
  }

  /** What one denomination of a product costs us, in cents — only in EUR, else unknown. */
  static costCents(p, amount) {
    if (String(p.senderCurrencyCode || '').toUpperCase() !== 'EUR') return null;
    const map = p.fixedRecipientToSenderDenominationsMap || {};
    let sender = map[String(amount)] ?? map[amount] ?? null;
    if (sender == null && Array.isArray(p.fixedRecipientDenominations)) {
      const i = p.fixedRecipientDenominations.map(Number).indexOf(Number(amount));
      if (i >= 0 && Array.isArray(p.fixedSenderDenominations)) sender = p.fixedSenderDenominations[i];
    }
    if (sender == null) {
      const rate = Number(p.recipientCurrencyToSenderCurrencyExchangeRate);
      if (Number.isFinite(rate) && rate > 0) sender = Number(amount) * rate;
    }
    if (sender == null || !Number.isFinite(Number(sender))) return null;
    const discount = Number(p.discountPercentage) || 0;
    const fee = Number(p.senderFee) || 0;
    const feePct = Number(p.senderFeePercentage) || 0;
    const net = Number(sender) * (1 - discount / 100) * (1 + feePct / 100) + fee;
    return Math.round(net * 100);
  }

  /** One Reloadly product → one catalog item per fixed denomination. */
  static normalise(p) {
    const denoms = Array.isArray(p.fixedRecipientDenominations) ? p.fixedRecipientDenominations : [];
    const cur = p.recipientCurrencyCode || '';
    const brand = p.brand?.brandName || '';
    return denoms.map((d) => ({
      supplierSku: `${p.productId}:${Number(d)}`,
      name: `${p.productName || brand || 'Gift card'} — ${Number(d)} ${cur}`.trim(),
      cost: ReloadlyConnector.costCents(p, d),
      availableStock: null,
      status: 'in_stock',
      region: p.country?.isoName || null,
      platform: brand || null,
      image: Array.isArray(p.logoUrls) ? p.logoUrls[0] || null : null,
    }));
  }

  async searchCatalog(query, { limit = 25 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!this.#configured || q.length < 3) return [];
    const params = new URLSearchParams({ countryCode: this.#country, size: '200', page: '1', productName: q });
    const data = await this.#request(`${RELOADLY.paths.products}?${params}`);
    const rows = Array.isArray(data) ? data : (data?.content || []);
    /* Filtered here as well: the productName filter is a convenience on
       Reloadly's side, and the picker must not show unrelated cards if it is
       ignored. */
    const words = q.split(/\s+/).filter((w) => w.length >= 3);
    return rows
      .filter((p) => {
        const hay = `${p.productName || ''} ${p.brand?.brandName || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w)) || hay.includes(q);
      })
      .flatMap((p) => ReloadlyConnector.normalise(p))
      .sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity))
      .slice(0, limit);
  }

  #deliveries(cards) {
    const arr = Array.isArray(cards) ? cards : (cards?.content || []);
    return arr.map((c) => {
      const code = String(c.cardNumber || c.code || '').trim();
      const pin = String(c.pinCode || c.pin || '').trim();
      const content = code && pin ? `${code} · PIN ${pin}` : (code || pin);
      return { type: 'code', content };
    }).filter((d) => d.content);
  }

  async createFulfillment(req) {
    if (!this.supportsFulfillment) {
      return { status: 'in_progress', externalRef: null, deliveries: [], raw: { manual: true } };
    }
    /* A sandbox card is not a card. Once the shop is open, selling one to a
       paying customer is the worst possible outcome of a forgotten switch —
       so it is a clear "no" here, before anything is sent, and the item goes
       to the next supplier or to a person. */
    if (this.sandbox && appConfig.isProd && launched()) {
      throw Object.assign(new Error('Reloadly is in sandbox mode on an open shop — sandbox codes are not real. Switch RELOADLY_SANDBOX off.'),
        { status: 409 });
    }
    const sku = parseSku(req.supplierSku);
    if (!sku) throw Object.assign(new Error(`Reloadly: SKU must be "<productId>:<amount>", got "${req.supplierSku}"`), { status: 400 });
    const quantity = Math.max(1, Number(req.quantity) || 1);
    const customIdentifier = `fm-${req.orderItemId || req.orderNumber || 'order'}`;
    let order;
    try {
      order = await this.#request(RELOADLY.paths.order, {
        method: 'POST',
        body: {
          productId: sku.productId, countryCode: this.#country, quantity,
          unitPrice: sku.amount, customIdentifier, senderName: 'ForgeMarket',
        },
        deadline: req.deadline,
      });
    } catch (err) {
      /* The identifier is unique per item: Reloadly refusing it as used means
         an order for this item already exists there — a purchase, not a "no".
         Never retried automatically; a person checks the Reloadly dashboard. */
      if (/custom.?identifier|duplicate|already/i.test(`${err.message} ${err.errorCode || ''}`)) {
        throw Object.assign(new Error(`Reloadly already has an order "${customIdentifier}" for this item — check the Reloadly dashboard before buying again.`),
          { outcomeUnknown: true, status: err.status });
      }
      throw err;
    }
    const externalRef = String(order?.transactionId ?? order?.id ?? '');
    if (!externalRef) throw Object.assign(new Error('Reloadly: order placed but no transactionId returned'), { outcomeUnknown: true });
    const status = String(order?.status || '').toUpperCase();
    if (RELOADLY.failed.includes(status)) return { status: 'failed', externalRef, error: `Reloadly: ${status}`, raw: order };
    if (RELOADLY.done.includes(status)) {
      let cards = [];
      try { cards = await this.#request(RELOADLY.paths.cards(externalRef), { deadline: req.deadline }); } catch { cards = []; }
      const deliveries = this.#deliveries(cards);
      // Paid but no code yet: never "fulfilled" without one — the sweep polls on.
      if (deliveries.length) return { status: 'fulfilled', externalRef, deliveries, raw: order };
    }
    return { status: 'in_progress', externalRef, raw: order };
  }

  async checkFulfillment(externalRef, { deadline } = {}) {
    let cards = [];
    try { cards = await this.#request(RELOADLY.paths.cards(externalRef), { deadline }); } catch { cards = []; }
    const deliveries = this.#deliveries(cards);
    if (deliveries.length) return { status: 'fulfilled', externalRef, deliveries };
    try {
      const tx = await this.#request(RELOADLY.paths.transaction(externalRef), { deadline });
      const status = String(tx?.status || tx?.transaction?.status || '').toUpperCase();
      if (RELOADLY.failed.includes(status)) return { status: 'failed', externalRef, error: `Reloadly: ${status}`, raw: tx };
    } catch { /* status briefly unavailable: ask again next sweep */ }
    return { status: 'in_progress', externalRef };
  }
}
