/**
 * SupplierConnector — the abstraction every supplier integration implements.
 *
 * Suppliers are NOT hardcoded anywhere. A supplier row in the database carries
 * a `connector_kind` (api | csv | manual) and a JSON `config`; the registry
 * instantiates the matching connector class with that data. Adding a new
 * integration style means adding one subclass and registering it — no changes
 * to orders, fulfillment, or the rest of the platform.
 *
 * A normalized catalog item looks like:
 *   { supplierSku, name, cost, price, availableStock, status, region?, platform?, url? }
 * where status ∈ in_stock | out_of_stock | discontinued. The last three are
 * optional context for a human choosing between near-identical listings — the
 * same game in a different region is a different product to the buyer.
 *
 * A fulfillment result looks like:
 *   { status, externalRef, deliveries: [{ type, content, filename }], raw }
 * where status ∈ fulfilled | in_progress | failed.
 */
/**
 * The terms worth trying for a product name, best first.
 *
 * A shop writes "1,000 Robux". A supplier lists "Roblox 1000 Robux Card".
 * Searching the shop's own product name therefore returns NOTHING — measured
 * against a live catalogue: `1,000 Robux` → 0 hits, `1000 Robux` → 1. Every
 * product in this catalogue is named with a thousands separator, so the picker
 * would have come back empty for essentially all of them and the honest-looking
 * conclusion would have been "this supplier does not carry what we sell".
 *
 * So the separator is normalised, and if the full name finds nothing we fall
 * back to shorter terms: without the leading quantity, and the part after the
 * dash — which for names like "1,155 Diamonds — Mobile Legends" is the game,
 * usually the best search term of the three.
 *
 * Ordered, deduped, and capped, because each one is a request to somebody
 * else's API.
 */
export function searchTermsFor(name, { max = 3 } = {}) {
  const base = String(name || '')
    // 1,000 → 1000. Only between digits, so "Rainbow Six: Siege, Gold" is safe.
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return [];

  const out = [base];
  // Drop a leading quantity: "1000 Robux" → "Robux".
  const noQty = base.replace(/^[\d.,]+\s*/, '').trim();
  if (noQty) out.push(noQty);
  // The part after an em dash, en dash or hyphen separator — usually the game.
  const after = base.split(/\s+[—–-]\s+/).pop().trim();
  if (after && after !== base) out.push(after);

  return [...new Set(out)].filter((t) => t.length >= 3).slice(0, max);
}

export class SupplierConnector {
  /** @param {object} supplier row from `suppliers` (config already parsed) */
  constructor(supplier) {
    this.supplier = supplier;
    this.config = supplier.config || {};
  }

  /** Stable identifier of the connector kind. Subclasses override. */
  static kind = 'base';

  /** Whether this connector can sync catalog data automatically. */
  get supportsSync() { return false; }

  /** Whether this connector can fulfill orders programmatically. */
  get supportsFulfillment() { return false; }

  /** Validate connectivity/config. @returns {Promise<{ok:boolean, detail?:string}>} */
  async testConnection() { return { ok: true, detail: 'No connectivity check for this connector' }; }

  /**
   * Return the supplier's full catalog as normalized items. Connectors that
   * cannot enumerate (e.g. manual) return []. Used by inventory/price/status sync.
   * @returns {Promise<Array>}
   */
  async fetchCatalog() { return []; }

  /**
   * Find catalog items matching a search term.
   *
   * The default enumerates `fetchCatalog()` and filters it here, which is right
   * for a connector whose catalogue is a file or a short list. A connector
   * whose supplier can search SERVER-SIDE should override this — filtering the
   * first hundred rows of a hundred-thousand-item catalogue locally is not a
   * search, it is a coincidence.
   *
   * @param {string} query
   * @param {{limit?: number}} opts
   * @returns {Promise<Array>} normalized catalog items (see header)
   */
  async searchCatalog(query, { limit = 25 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const all = await this.fetchCatalog();
    return all.filter((i) => String(i.name || '').toLowerCase().includes(q)).slice(0, limit);
  }

  /** Whether this connector searches at the supplier rather than locally. */
  get supportsSearch() { return false; }

  /**
   * Submit a fulfillment request to the supplier.
   * @param {object} req normalized fulfillment request
   * @returns {Promise<object>} fulfillment result (see header)
   */
  async createFulfillment(req) {
    throw new Error(`${this.constructor.kind} connector does not support fulfillment`);
  }

  /**
   * Poll the status of a previously submitted fulfillment.
   * @param {string} externalRef
   * @returns {Promise<object>} fulfillment result
   */
  async checkFulfillment(externalRef) {
    throw new Error(`${this.constructor.kind} connector does not support status polling`);
  }
}
