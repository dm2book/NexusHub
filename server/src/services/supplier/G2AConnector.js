/**
 * G2AConnector — real programmatic buying via the G2A Integration (Import) API.
 *
 * G2A publishes a documented order API, so — like Kinguin, and unlike the P2P
 * marketplaces Eldorado.gg / Eneba (seller-only APIs) — paid orders can be
 * auto-sourced hands-off. G2A's buy flow is three steps:
 *   1. add an order       POST /v3/order            { product_id, currency, max_price }
 *   2. pay for the order   PUT  /v3/order/pay        { order_id }
 *   3. collect the key     GET  /v3/order/key/{id}   → { key }
 * Auth: header  `Authorization: {apiHash}, {token}`  where
 *   token = sha256(apiHash + email + apiKey).
 *
 * config (on the supplier row):
 *   { apiHash, apiKey, email, currency?: "EUR", baseUrl?, autoDeliver: true }
 *
 * max_price is set from our stored buy cost, so G2A never fills the order above
 * the price we're willing to pay (margin guard at the source). Delivery can be
 * momentarily async → the serial queue re-polls checkFulfillment for the key.
 *
 * Field/endpoint names follow G2A's documented v3 REST contract; centralised
 * here so they can be tuned to your account without touching the platform.
 */
import { createHash } from 'node:crypto';
import { SupplierConnector } from './SupplierConnector.js';

// Base host only — every request path below already carries its /v3 prefix, so
// keeping /v3 here too would double it (https://api.g2a.com/v3/v3/order → 404).
const DEFAULT_BASE = 'https://api.g2a.com';
const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

export class G2AConnector extends SupplierConnector {
  static kind = 'g2a';

  get #creds() {
    const { apiHash, email } = this.config;
    return { apiHash, email, secret: this.config.apiKey || this.config.apiSecret };
  }
  get #configured() { const c = this.#creds; return !!(c.apiHash && c.email && c.secret); }

  get supportsSync() { return false; } // catalog import is a separate API; buying only here
  get supportsFulfillment() { return this.#configured && this.config.autoDeliver !== false; }

  get #base() { return (this.config.baseUrl || DEFAULT_BASE).replace(/\/$/, ''); }

  #authHeader() {
    const { apiHash, email, secret } = this.#creds;
    const token = createHash('sha256').update(`${apiHash}${email}${secret}`).digest('hex');
    return `${apiHash}, ${token}`;
  }

  async #request(path, { method = 'GET', body } = {}) {
    if (!this.#configured) throw new Error('G2A: apiHash, email and apiKey are required');
    const res = await fetch(`${this.#base}${path}`, {
      method,
      headers: {
        'Authorization': this.#authHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) throw new Error(`G2A API: ${data?.message || data?.error || `HTTP ${res.status}`}`);
    return data;
  }

  async testConnection() {
    if (!this.#configured) return { ok: false, detail: 'Add G2A apiHash, email and apiKey to enable buying.' };
    try {
      // A lightweight authenticated read validates the credentials/signature.
      await this.#request('/v3/account');
      return { ok: true, detail: 'Connected to G2A.' };
    } catch (e) { return { ok: false, detail: e.message }; }
  }

  async fetchCatalog() { return []; } // no sync via this connector

  /** Add + pay for the order (the actual purchase); key is collected on poll. */
  async createFulfillment(req) {
    if (!this.supportsFulfillment) {
      return { status: 'in_progress', externalRef: null, deliveries: [], raw: { manual: true } };
    }
    const currency = this.config.currency || 'EUR';
    const qty = Math.max(1, Number(req.quantity) || 1);
    // max_price caps the WHOLE order line (qty × unit cost) so a multi-unit buy
    // is not rejected by a single-unit cap, while still never exceeding our cost.
    const maxPrice = req.cost != null ? (Math.round(req.cost) * qty) / 100 : undefined;
    const added = await this.#request('/v3/order', {
      method: 'POST',
      body: { product_id: String(req.supplierSku), currency, quantity: qty,
        ...(maxPrice != null ? { max_price: maxPrice } : {}) },
    });
    const orderId = String(added?.order_id ?? added?.orderId ?? '');
    if (!orderId) throw new Error('G2A: order added but no order_id returned');
    await this.#request('/v3/order/pay', { method: 'PUT', body: { order_id: orderId } });
    return { status: 'in_progress', externalRef: orderId, raw: added };
  }

  /** Poll the order; once the key is issued, deliver it. */
  async checkFulfillment(externalRef) {
    let status = '';
    try {
      const details = await this.#request(`/v3/order/details/${encodeURIComponent(externalRef)}`);
      status = String(details?.status || '').toLowerCase();
      if (['canceled', 'cancelled', 'refunded', 'failed', 'error'].includes(status)) {
        return { status: 'failed', externalRef, raw: details };
      }
    } catch { /* details may be briefly unavailable right after pay */ }
    try {
      const keyResp = await this.#request(`/v3/order/key/${encodeURIComponent(externalRef)}`);
      // Accept a single key or a list (multi-unit orders return several).
      const rawKeys = Array.isArray(keyResp?.keys) ? keyResp.keys
        : Array.isArray(keyResp?.data) ? keyResp.data
        : [keyResp?.key ?? keyResp?.data?.key];
      const deliveries = rawKeys
        .map((k) => ({ type: 'code', content: String((k && k.key) || k || '') }))
        .filter((d) => d.content);
      if (deliveries.length) return { status: 'fulfilled', externalRef, deliveries };
    } catch { /* key not issued yet */ }
    return { status: 'in_progress', externalRef };
  }
}
