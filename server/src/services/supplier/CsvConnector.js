/**
 * CsvConnector — integrates suppliers that publish a CSV feed (catalog,
 * inventory, prices) over HTTP or as inline content.
 *
 * config = {
 *   source: { type: 'url'|'inline', url, content },
 *   delimiter: ',', hasHeader: true,
 *   columns: { sku, name, cost, price, stock, status, image },  // header name OR index
 *   amounts: 'minor' | 'major',   // how a WHOLE number is read; "8.00" is always euros
 *   statusMap: { ... }
 * }
 *
 * CSV suppliers are catalog-sync only; fulfillment falls back to the manual
 * workflow (handled by the fulfillment service when supportsFulfillment=false).
 */
import { SupplierConnector } from './SupplierConnector.js';
import { parseMoney } from '../../utils/money.js';

export class CsvConnector extends SupplierConnector {
  static kind = 'csv';
  get supportsSync() { return true; }
  get supportsFulfillment() { return false; }

  async #loadText() {
    const src = this.config.source || {};
    if (src.type === 'inline') return src.content || '';
    if (src.type === 'url' || src.url) {
      const res = await fetch(src.url, { headers: this.config.headers || {} });
      if (!res.ok) throw new Error(`CSV fetch failed: HTTP ${res.status}`);
      return res.text();
    }
    throw new Error('CSV source not configured');
  }

  async testConnection() {
    try {
      const rows = parseCsv(await this.#loadText(),
        this.config.delimiter || ',', this.config.hasHeader !== false);
      return { ok: true, detail: `${rows.length} rows parsed` };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  async fetchCatalog() {
    const text = await this.#loadText();
    const rows = parseCsv(text, this.config.delimiter || ',', this.config.hasHeader !== false);
    const cols = this.config.columns || {};
    return rows.map((row) => {
      const cell = (key) => {
        const col = cols[key];
        if (col == null) return undefined;
        return typeof col === 'number' ? row._values[col] : row[col];
      };
      const stock = cell('stock');
      return {
        supplierSku: String(cell('sku') ?? '').trim(),
        name: cell('name'),
        cost: toMinor(cell('cost'), this.config),
        price: toMinor(cell('price'), this.config),
        availableStock: stock == null || stock === '' ? null : Number(stock),
        /* Optional `image` column: a price list that links a product photo lets
           the shop use it instead of a drawn placeholder. */
        image: cell('image') ? String(cell('image')).trim() : null,
        status: this.#mapStatus(cell('status'), stock),
      };
    }).filter((i) => i.supplierSku);
  }

  #mapStatus(raw, stock) {
    const map = this.config.statusMap;
    if (map && raw != null) {
      for (const [norm, vals] of Object.entries(map)) {
        if (vals.map(String).includes(String(raw))) return norm;
      }
    }
    if (stock != null && stock !== '') return Number(stock) > 0 ? 'in_stock' : 'out_of_stock';
    return 'in_stock';
  }
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields and embedded commas). */
export function parseCsv(text, delimiter = ',', hasHeader = true) {
  const rows = [];
  let field = '', record = [], inQuotes = false;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { if (record.length || field) { pushField(); rows.push(record); record = []; } };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) pushField();
    else if (c === '\n') pushRecord();
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  pushRecord();

  if (!rows.length) return [];
  if (!hasHeader) return rows.map((vals) => ({ _values: vals }));

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((vals) => {
    const obj = { _values: vals };
    header.forEach((h, idx) => { obj[h] = vals[idx]; });
    return obj;
  });
}

/**
 * A cell as cents.
 *
 * This used to be `Number(text)`, then "integers are already cents, decimals
 * are euros". The trouble is that `Number("8.00")` IS an integer: every price
 * a supplier wrote with ",00" or ".00" was read as that many CENTS — a €8
 * card cost the shop 8 cents, every margin built on it was ninety-odd percent,
 * and the margin guard waved through any purchase at all.
 *
 * So the decision is made on the TEXT. A decimal separator means the value is
 * written in euros — so does a currency sign — and it is read with the same parser the cost import uses
 * ("12,50", "€8,00", "1.234,56"). A bare whole number is genuinely ambiguous
 * — "800" in a machine feed is usually cents, "8" in a hand-made list is
 * usually euros — so it keeps the old meaning (cents) unless the supplier's
 * config says `amounts: "major"`.
 */
const toMinor = (v, { amounts = 'minor' } = {}) => {
  if (v == null || v === '') return null;
  const text = String(v).trim();
  /* A decimal separator or a currency sign both say "this is written in euros". */
  if (/\d[.,]\d/.test(text) || /[€$£]/.test(text)) return parseMoney(text);
  const n = Number(text.replace(/[^0-9\-]/g, ''));
  if (!text || Number.isNaN(n)) return null;
  return amounts === 'major' ? n * 100 : n;
};
