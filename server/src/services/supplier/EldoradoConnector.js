/**
 * EldoradoConnector — integration with the Eldorado.gg marketplace seller API.
 *
 * Eldorado is one of the largest digital-goods / game-currency marketplaces, so
 * it's a natural fulfilment source for Robux, V-Bucks, gift cards & game
 * currency. This connector plugs into the same SupplierConnector interface as
 * every other supplier — orders, fulfilment and sync don't change; you just add
 * a supplier with connector_kind = 'eldorado' and credentials.
 *
 * config (stored on the supplier row):
 *   {
 *     apiKey:    "elo_live_...",                     // seller API key
 *     baseUrl:   "https://api.eldorado.gg",          // optional override
 *     sellerId:  "12345",                            // optional
 *     autoDeliver: true                              // submit orders automatically
 *   }
 *
 * Eldorado's partner API is access-gated, so the request/response field names
 * below follow their documented REST shape and are centralised in #map* so they
 * can be tuned to your account without touching the rest of the platform. When
 * no apiKey is configured the connector still syncs nothing and routes
 * fulfilment to the manual workflow (status: in_progress) — never throwing.
 */
import { SupplierConnector } from './SupplierConnector.js';

const DEFAULT_BASE = 'https://api.eldorado.gg';

export class EldoradoConnector extends SupplierConnector {
  static kind = 'eldorado';

  get supportsSync() { return !!this.config.apiKey; }
  get supportsFulfillment() { return !!this.config.apiKey && this.config.autoDeliver !== false; }

  get #base() { return (this.config.baseUrl || DEFAULT_BASE).replace(/\/$/, ''); }

  async #request(path, { method = 'GET', body } = {}) {
    if (!this.config.apiKey) throw new Error('Eldorado: no apiKey configured');
    const res = await fetch(`${this.#base}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(`Eldorado API: ${msg}`);
    }
    return data;
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { ok: false, detail: 'Add an Eldorado seller apiKey to enable sync & auto-fulfilment.' };
    }
    try {
      // Lightweight authenticated call to validate the key.
      await this.#request('/v1/account');
      return { ok: true, detail: 'Connected to Eldorado seller API.' };
    } catch (e) {
      return { ok: false, detail: e.message };
    }
  }

  async fetchCatalog() {
    if (!this.config.apiKey) return [];
    const sellerId = this.config.sellerId ? `?sellerId=${encodeURIComponent(this.config.sellerId)}` : '';
    const data = await this.#request(`/v1/offers${sellerId}`);
    const offers = Array.isArray(data) ? data : (data?.offers || data?.results || []);
    return offers.map((o) => this.#mapOffer(o)).filter(Boolean);
  }

  async createFulfillment(req) {
    // Without auto-deliver, hand off to the manual workflow.
    if (!this.supportsFulfillment) {
      return { status: 'in_progress', externalRef: null, deliveries: [], raw: { manual: true } };
    }
    const order = await this.#request('/v1/orders', {
      method: 'POST',
      body: {
        offerId: req.supplierSku,
        // The exact listing to buy from, when provided (e.g. an Eldorado URL).
        listingUrl: req.supplierUrl || undefined,
        quantity: req.quantity || 1,
        // Delivery target depends on the product (game username, email, etc.).
        deliveryDetails: req.deliveryDetails || req.metadata || {},
        externalReference: req.orderId,
      },
    });
    return this.#mapOrder(order);
  }

  async checkFulfillment(externalRef) {
    const order = await this.#request(`/v1/orders/${encodeURIComponent(externalRef)}`);
    return this.#mapOrder(order);
  }

  // ── field mapping (tune to your Eldorado account) ──────────────────────────
  #mapOffer(o) {
    if (!o) return null;
    const cents = (v) => Math.round((Number(v) || 0) * 100);
    return {
      supplierSku: String(o.id ?? o.offerId ?? o.sku ?? ''),
      name: o.title || o.name || 'Eldorado offer',
      cost: cents(o.price ?? o.unitPrice ?? o.amount),
      price: cents(o.suggestedPrice ?? o.price),
      availableStock: Number(o.stock ?? o.quantity ?? o.available ?? 0),
      status: (o.stock ?? o.available ?? 1) > 0 ? 'in_stock' : 'out_of_stock',
    };
  }

  #mapOrder(o) {
    const raw = o || {};
    const s = String(raw.status || raw.state || '').toLowerCase();
    const status = ['delivered', 'completed', 'fulfilled', 'success'].includes(s) ? 'fulfilled'
      : ['failed', 'cancelled', 'canceled', 'refunded', 'error'].includes(s) ? 'failed'
      : 'in_progress';
    const codes = raw.deliveries || raw.codes || raw.items || [];
    const deliveries = (Array.isArray(codes) ? codes : []).map((c) => ({
      type: c.type || 'code',
      content: c.content || c.code || c.value || String(c),
      filename: c.filename,
    }));
    return { status, externalRef: String(raw.id ?? raw.orderId ?? ''), deliveries, raw };
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
