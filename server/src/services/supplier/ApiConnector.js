/**
 * ApiConnector — integrates suppliers that expose an HTTP/JSON API.
 *
 * Everything is driven by `supplier.config` so no supplier is hardcoded:
 *   {
 *     baseUrl, auth: { type: 'bearer'|'header'|'none', token, headerName },
 *     endpoints: { catalog, fulfill, status },   // paths relative to baseUrl
 *     fieldMap: {                                 // map provider fields -> ours
 *       sku, name, cost, price, stock, status
 *     },
 *     statusMap: { in_stock: [...], out_of_stock: [...] }  // optional
 *   }
 *
 * Credentials should be injected via `credentials_ref` resolution in production;
 * for flexibility a literal token in config is also supported.
 */
import { SupplierConnector } from './SupplierConnector.js';

export class ApiConnector extends SupplierConnector {
  static kind = 'api';
  get supportsSync() { return true; }
  get supportsFulfillment() { return !!this.config?.endpoints?.fulfill; }

  #headers() {
    const auth = this.config.auth || {};
    const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (auth.type === 'bearer') h.Authorization = `Bearer ${auth.token}`;
    else if (auth.type === 'header') h[auth.headerName || 'X-API-Key'] = auth.token;
    return { ...h, ...(this.config.headers || {}) };
  }

  #url(path) {
    const base = (this.config.baseUrl || '').replace(/\/$/, '');
    return `${base}/${String(path || '').replace(/^\//, '')}`;
  }

  async #request(path, { method = 'GET', body } = {}) {
    const res = await fetch(this.#url(path), {
      method,
      headers: this.#headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || `HTTP ${res.status}`;
      throw new Error(`Supplier API error: ${msg}`);
    }
    return data;
  }

  async testConnection() {
    try {
      await this.#request(this.config.endpoints?.catalog || '/');
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  #normalize(item) {
    const fm = this.config.fieldMap || {};
    const pick = (key, fallback) => (fm[key] ? item[fm[key]] : item[fallback]);
    const rawStatus = pick('status', 'status');
    return {
      supplierSku: String(pick('sku', 'sku')),
      name: pick('name', 'name'),
      cost: toMinor(pick('cost', 'cost')),
      price: toMinor(pick('price', 'price')),
      availableStock: numOrNull(pick('stock', 'stock')),
      status: this.#mapStatus(rawStatus, pick('stock', 'stock')),
    };
  }

  #mapStatus(rawStatus, stock) {
    const map = this.config.statusMap;
    if (map && rawStatus != null) {
      for (const [norm, values] of Object.entries(map)) {
        if (values.map(String).includes(String(rawStatus))) return norm;
      }
    }
    if (rawStatus != null) {
      const s = String(rawStatus).toLowerCase();
      if (['discontinued', 'inactive', 'deleted'].includes(s)) return 'discontinued';
      if (['out', 'out_of_stock', 'oos', '0', 'false'].includes(s)) return 'out_of_stock';
      if (['in_stock', 'available', 'active', 'true'].includes(s)) return 'in_stock';
    }
    if (stock != null) return Number(stock) > 0 ? 'in_stock' : 'out_of_stock';
    return 'in_stock';
  }

  async fetchCatalog() {
    const path = this.config.endpoints?.catalog;
    if (!path) return [];
    const data = await this.#request(path);
    const list = Array.isArray(data) ? data
      : Array.isArray(data?.items) ? data.items
      : Array.isArray(data?.data) ? data.data : [];
    return list.map((i) => this.#normalize(i));
  }

  async createFulfillment(req) {
    const path = this.config.endpoints?.fulfill;
    if (!path) throw new Error('No fulfill endpoint configured');
    const data = await this.#request(path, {
      method: 'POST',
      body: {
        orderNumber: req.orderNumber,
        sku: req.supplierSku,
        quantity: req.quantity,
        customerEmail: req.customerEmail,
        metadata: req.metadata,
      },
    });
    return this.#normalizeResult(data);
  }

  async checkFulfillment(externalRef) {
    const tmpl = this.config.endpoints?.status;
    if (!tmpl) throw new Error('No status endpoint configured');
    const path = tmpl.replace('{ref}', encodeURIComponent(externalRef));
    return this.#normalizeResult(await this.#request(path));
  }

  #normalizeResult(data) {
    const fm = this.config.resultMap || {};
    const status = String(data?.[fm.status || 'status'] || 'in_progress').toLowerCase();
    const norm = ['fulfilled', 'completed', 'success', 'done'].includes(status) ? 'fulfilled'
      : ['failed', 'error', 'rejected'].includes(status) ? 'failed' : 'in_progress';
    const rawDeliveries = data?.[fm.deliveries || 'deliveries'] || data?.codes || [];
    const deliveries = (Array.isArray(rawDeliveries) ? rawDeliveries : [rawDeliveries])
      .filter(Boolean)
      .map((d) => (typeof d === 'string'
        ? { type: 'code', content: d }
        : { type: d.type || 'code', content: d.content || d.code || d.value, filename: d.filename }));
    return {
      status: norm,
      externalRef: data?.[fm.ref || 'id'] || data?.reference || null,
      deliveries,
      raw: data,
    };
  }
}

const numOrNull = (v) => (v == null || v === '' ? null : Number(v));
const toMinor = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  // Heuristic: integers already in minor units stay; decimals are major units.
  return Number.isInteger(n) ? n : Math.round(n * 100);
};
