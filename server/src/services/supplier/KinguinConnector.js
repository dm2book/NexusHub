/**
 * KinguinConnector — real programmatic buying via the Kinguin eCommerce API.
 *
 * Unlike a P2P marketplace such as Eldorado.gg (which has NO public buyer API —
 * you can't auto-purchase another seller's listing), Kinguin publishes a
 * documented dropship/order API: you place an order for a product id, they
 * charge you only when your customer paid, and the key is delivered
 * asynchronously. That makes it a genuine hands-off fulfilment source for game
 * keys & gift cards.
 *
 * config (on the supplier row):
 *   { apiKey: "<kinguin api key>", baseUrl?: "...", autoDeliver: true }
 *
 * Flow (matches the platform's async fulfilment model):
 *   createFulfillment → POST /v1/order            → returns { in_progress, ref }
 *   checkFulfillment  → GET  /v2/order/{ref}       → when 'completed', then
 *                       GET  /v2/order/{ref}/keys  → real serials → deliveries
 * The serial queue dispatches one buy at a time; maintenance re-polls the
 * in-progress order until the keys arrive.
 *
 * Docs: https://github.com/kinguinltdhk/Kinguin-eCommerce-API
 */
import { SupplierConnector } from './SupplierConnector.js';

const DEFAULT_BASE = 'https://gateway.kinguin.net/esa/api';
const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

export class KinguinConnector extends SupplierConnector {
  static kind = 'kinguin';

  get supportsSync() { return !!this.config.apiKey; }
  get supportsFulfillment() { return !!this.config.apiKey && this.config.autoDeliver !== false; }

  get #base() { return (this.config.baseUrl || DEFAULT_BASE).replace(/\/$/, ''); }

  async #request(path, { method = 'GET', body } = {}) {
    if (!this.config.apiKey) throw new Error('Kinguin: no apiKey configured');
    const res = await fetch(`${this.#base}${path}`, {
      method,
      headers: {
        'X-Api-Key': this.config.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) throw new Error(`Kinguin API: ${data?.message || data?.error || `HTTP ${res.status}`}`);
    return data;
  }

  async testConnection() {
    if (!this.config.apiKey) return { ok: false, detail: 'Add a Kinguin apiKey to enable buying.' };
    try { await this.#request('/v1/products?limit=1'); return { ok: true, detail: 'Connected to Kinguin.' }; }
    catch (e) { return { ok: false, detail: e.message }; }
  }

  /**
   * One Kinguin listing → one normalized catalog item.
   *
   * Shared by fetchCatalog and searchCatalog on purpose. Two copies of this
   * mapping is how the price you see while choosing a product stops matching
   * the price the sync writes a week later — and the cost is what the margin
   * guard compares against before it is allowed to buy anything.
   */
  static normalise(p) {
    const qty = Number(p.qty ?? p.textQty ?? 0);
    return {
      supplierSku: String(p.kinguinId ?? p.productId ?? p.id ?? ''),
      name: p.name || p.originalName || 'Kinguin product',
      cost: Math.round(Number(p.price ?? p.retailPrice ?? 0) * 100),
      availableStock: Number.isFinite(qty) && qty > 0 ? qty : null,
      status: qty > 0 ? 'in_stock' : 'out_of_stock',
      /* Context a person needs to tell two near-identical listings apart. The
         same card in another region is a different product to the buyer, and
         picking the wrong one means selling something that will not redeem. */
      platform: p.platform || null,
      region: p.regionalLimitations || p.regionId || null,
      /* The cover Kinguin publishes with the listing. Several shapes, because
         the API has carried it as images.cover.url and, in older responses,
         as coverImageOriginal / coverImage. Anything else is no picture. */
      image: p.images?.cover?.url || p.coverImageOriginal || p.coverImage || null,
      url: p.kinguinId ? `https://www.kinguin.net/category/${p.kinguinId}` : null,
    };
  }

  #items(data) {
    const items = data?.results || data?.items || (Array.isArray(data) ? data : []);
    return items.map((p) => KinguinConnector.normalise(p)).filter((x) => x.supplierSku);
  }

  async fetchCatalog() {
    if (!this.config.apiKey) return [];
    return this.#items(await this.#request('/v1/products?limit=100'));
  }

  /* Kinguin searches server-side, which is the only useful kind here: the
     catalogue runs to tens of thousands of listings, so filtering the first
     hundred locally would find your product only by luck. */
  get supportsSearch() { return !!this.config.apiKey; }

  /**
   * Search the supplier's catalogue by name.
   *
   * `name` needs at least 3 characters per Kinguin's own documentation, so a
   * shorter term is refused HERE rather than sent and rejected — an API error
   * for something we can see is wrong is a worse answer than "type a bit more".
   *
   * Results are ordered so the ones you can actually buy come first: in stock
   * before out of stock, then cheapest. Nothing is filtered out — an
   * out-of-stock listing at the right price is still the product you were
   * looking for, and hiding it looks like the product does not exist.
   */
  async searchCatalog(query, { limit = 25 } = {}) {
    const q = String(query || '').trim();
    if (!this.config.apiKey || q.length < 3) return [];
    const params = new URLSearchParams({ name: q, limit: String(Math.min(Math.max(1, limit), 100)) });
    const rows = this.#items(await this.#request(`/v1/products?${params}`));
    return rows.sort((a, b) =>
      (a.status === 'in_stock' ? 0 : 1) - (b.status === 'in_stock' ? 0 : 1)
      || (a.cost - b.cost));
  }

  /** Place the buy order (async delivery — poll checkFulfillment for keys). */
  async createFulfillment(req) {
    if (!this.supportsFulfillment) {
      return { status: 'in_progress', externalRef: null, deliveries: [], raw: { manual: true } };
    }
    const price = req.cost != null ? Math.round(req.cost) / 100 : undefined; // cents → euros
    const order = await this.#request('/v1/order', {
      method: 'POST',
      body: {
        products: [{ kinguinId: Number(req.supplierSku), qty: req.quantity || 1, ...(price != null ? { price } : {}) }],
        orderExternalId: req.orderNumber || req.orderId,
      },
    });
    const externalRef = String(order?.orderId ?? order?.id ?? '');
    if (!externalRef) throw new Error('Kinguin: order created but no orderId returned');
    return { status: 'in_progress', externalRef, raw: order };
  }

  /** Poll the order; once completed, fetch the real serials and deliver them. */
  async checkFulfillment(externalRef) {
    const order = await this.#request(`/v2/order/${encodeURIComponent(externalRef)}`);
    const status = String(order?.status || '').toLowerCase();
    if (status === 'completed' || status === 'complete') {
      let keys = [];
      try { keys = await this.#request(`/v2/order/${encodeURIComponent(externalRef)}/keys`); } catch { keys = []; }
      const arr = Array.isArray(keys) ? keys : (keys?.results || []);
      const deliveries = arr
        .map((k) => ({ type: k.type && /image/i.test(k.type) ? 'image' : 'code', content: k.serial || k.key || '' }))
        .filter((d) => d.content);
      // NEVER mark fulfilled without an actual key: a transient error on the
      // /keys call would otherwise complete the order with no code delivered
      // (we paid the supplier, the buyer gets nothing). Stay in_progress so the
      // maintenance sweep re-polls until the real serials arrive.
      if (!deliveries.length) return { status: 'in_progress', externalRef, raw: order };
      return { status: 'fulfilled', externalRef, deliveries, raw: order };
    }
    if (['canceled', 'cancelled', 'refunded', 'failed'].includes(status)) {
      return { status: 'failed', externalRef, raw: order };
    }
    return { status: 'in_progress', externalRef, raw: order };
  }
}
